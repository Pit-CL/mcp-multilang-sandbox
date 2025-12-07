/**
 * ContainerPool - Manages a pool of pre-warmed containers for fast execution
 */

import { dockerClient } from '../docker/DockerClient.js';
import { Container } from '../docker/Container.js';
import type { Language, PoolConfig, PoolStats } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

interface PooledContainer {
  container: Container;
  language: Language;
  createdAt: Date;
  lastUsedAt: Date;
  useCount: number;
  healthy: boolean;
}

export class ContainerPool {
  private pool: Map<string, PooledContainer> = new Map();
  private config: PoolConfig;
  private log = createLogger({ component: 'ContainerPool' });
  private healthCheckInterval?: NodeJS.Timeout;
  private static instance: ContainerPool;

  private constructor(config: PoolConfig) {
    this.config = config;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: PoolConfig): ContainerPool {
    if (!ContainerPool.instance) {
      if (!config) {
        throw new Error('ContainerPool must be initialized with config on first call');
      }
      ContainerPool.instance = new ContainerPool(config);
    }
    return ContainerPool.instance;
  }

  /**
   * Initialize pool with pre-warmed containers
   */
  public async initialize(): Promise<void> {
    this.log.info('Initializing container pool...');

    try {
      // Pre-warm containers for configured languages
      const warmupPromises = this.config.warmupLanguages.map(language =>
        this.warmupLanguage(language, this.config.minIdle)
      );

      await Promise.all(warmupPromises);

      // Start health check loop
      this.startHealthChecks();

      this.log.info(
        { poolSize: this.pool.size, languages: this.config.warmupLanguages },
        'Container pool initialized'
      );
    } catch (error: any) {
      this.log.error({ error: error.message }, 'Failed to initialize pool');
      throw error;
    }
  }

  /**
   * Acquire a container from the pool
   */
  public async acquire(language: Language): Promise<Container> {
    const startTime = Date.now();

    try {
      // Try to get an available container from pool
      const pooled = this.getAvailableContainer(language);

      if (pooled) {
        // Update usage stats
        pooled.lastUsedAt = new Date();
        pooled.useCount++;

        const waitTime = Date.now() - startTime;
        this.log.info(
          { language, containerId: pooled.container.id, waitTime },
          'Container acquired from pool (cache hit)'
        );

        // Backfill asynchronously
        this.backfillAsync(language);

        return pooled.container;
      }

      // Pool miss - create new container
      this.log.info({ language }, 'Pool miss - creating new container');
      const container = await this.createContainer(language);

      const waitTime = Date.now() - startTime;
      this.log.info(
        { language, containerId: container.id, waitTime },
        'Container acquired (cache miss)'
      );

      return container;
    } catch (error: any) {
      this.log.error(
        { language, error: error.message },
        'Failed to acquire container'
      );
      throw error;
    }
  }

  /**
   * Release a container back to the pool
   */
  public async release(container: Container, language: Language): Promise<void> {
    try {
      // Check if pool is full
      if (this.pool.size >= this.config.maxActive) {
        this.log.info(
          { containerId: container.id },
          'Pool full - evicting oldest container'
        );
        await this.evictOldest();
      }

      // Clean container before returning to pool
      await this.cleanContainer(container);

      // Add to pool
      const pooled: PooledContainer = {
        container,
        language,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        useCount: 0,
        healthy: true,
      };

      this.pool.set(container.id, pooled);

      this.log.info(
        { containerId: container.id, poolSize: this.pool.size },
        'Container released to pool'
      );
    } catch (error: any) {
      // If cleanup fails, destroy the container
      this.log.error(
        { containerId: container.id, error: error.message },
        'Failed to release container - destroying'
      );
      await this.destroyContainer(container);
    }
  }

  /**
   * Drain the pool (remove all containers)
   */
  public async drain(): Promise<void> {
    this.log.info({ poolSize: this.pool.size }, 'Draining container pool...');

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Stop and remove all containers
    const promises = Array.from(this.pool.values()).map(pooled =>
      this.destroyContainer(pooled.container)
    );

    await Promise.allSettled(promises);

    this.pool.clear();

    this.log.info('Container pool drained');
  }

  /**
   * Get pool statistics
   */
  public getStats(): PoolStats {
    const byLanguage: Record<Language, number> = {} as any;

    for (const pooled of this.pool.values()) {
      byLanguage[pooled.language] = (byLanguage[pooled.language] || 0) + 1;
    }

    const healthy = Array.from(this.pool.values()).filter(p => p.healthy).length;
    const unhealthy = this.pool.size - healthy;

    return {
      total: this.pool.size,
      available: this.pool.size,
      inUse: 0, // Containers in use are not in pool
      byLanguage,
      healthy,
      unhealthy,
    };
  }

  // ========== Private Methods ==========

  /**
   * Get an available container for the given language
   */
  private getAvailableContainer(language: Language): PooledContainer | null {
    for (const pooled of this.pool.values()) {
      if (pooled.language === language && pooled.healthy) {
        // Remove from pool (will be re-added on release)
        this.pool.delete(pooled.container.id);
        return pooled;
      }
    }

    return null;
  }

  /**
   * Warm up N containers for a language
   */
  private async warmupLanguage(language: Language, count: number): Promise<void> {
    this.log.info({ language, count }, 'Warming up containers');

    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(
        (async () => {
          const container = await this.createContainer(language);
          const pooled: PooledContainer = {
            container,
            language,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            useCount: 0,
            healthy: true,
          };
          this.pool.set(container.id, pooled);
        })()
      );
    }

    await Promise.all(promises);

    this.log.info({ language, count }, 'Containers warmed up');
  }

  /**
   * Create a new container
   */
  private async createContainer(language: Language): Promise<Container> {
    // Get default image for language
    const imageMap: Record<Language, string> = {
      python: 'python:3.11-slim',
      typescript: 'oven/bun:latest',
      javascript: 'node:20-alpine',
      go: 'golang:1.21-alpine',
      rust: 'rust:1.75-alpine',
      bash: 'alpine:latest',
      ruby: 'ruby:3.2-alpine',
    };

    const image = imageMap[language];

    const dockerContainer = await dockerClient.createContainer({
      image,
      language,
      memory: this.config.containerMemory || '512m',
      cpus: this.config.containerCpus || '1.0',
      network: 'none', // Security
    });

    const container = new Container(dockerContainer, language);
    await container.start();

    return container;
  }

  /**
   * Clean a container (reset state)
   */
  private async cleanContainer(container: Container): Promise<void> {
    try {
      // Remove all files from workspace
      await container.exec(['sh', '-c', 'rm -rf /workspace/* /workspace/.*'], {
        timeout: 5000,
      }).catch(() => {
        // Ignore errors (some files might not exist)
      });

      // Recreate workspace
      await container.exec(['mkdir', '-p', '/workspace'], { timeout: 5000 });
    } catch (error: any) {
      this.log.warn(
        { containerId: container.id, error: error.message },
        'Failed to clean container'
      );
      throw error;
    }
  }

  /**
   * Destroy a container
   */
  private async destroyContainer(container: Container): Promise<void> {
    try {
      await container.stop();
      await container.remove();
      this.pool.delete(container.id);
    } catch (error: any) {
      this.log.error(
        { containerId: container.id, error: error.message },
        'Failed to destroy container'
      );
    }
  }

  /**
   * Evict oldest container (LRU)
   */
  private async evictOldest(): Promise<void> {
    let oldest: PooledContainer | null = null;

    for (const pooled of this.pool.values()) {
      if (!oldest || pooled.lastUsedAt < oldest.lastUsedAt) {
        oldest = pooled;
      }
    }

    if (oldest) {
      this.log.info(
        { containerId: oldest.container.id, language: oldest.language },
        'Evicting oldest container'
      );
      await this.destroyContainer(oldest.container);
    }
  }

  /**
   * Backfill pool asynchronously
   */
  private backfillAsync(language: Language): void {
    // Don't await - run in background
    setImmediate(async () => {
      try {
        const count = this.getLanguageCount(language);

        if (count < this.config.minIdle) {
          this.log.info(
            { language, current: count, target: this.config.minIdle },
            'Backfilling pool'
          );

          const container = await this.createContainer(language);
          const pooled: PooledContainer = {
            container,
            language,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            useCount: 0,
            healthy: true,
          };

          this.pool.set(container.id, pooled);
        }
      } catch (error: any) {
        this.log.error(
          { language, error: error.message },
          'Backfill failed'
        );
      }
    });
  }

  /**
   * Get count of containers for a language
   */
  private getLanguageCount(language: Language): number {
    let count = 0;
    for (const pooled of this.pool.values()) {
      if (pooled.language === language) {
        count++;
      }
    }
    return count;
  }

  /**
   * Start health check loop
   */
  private startHealthChecks(): void {
    const interval = this.config.healthCheckInterval || 30000;

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks();
    }, interval);

    this.log.info({ interval }, 'Health checks started');
  }

  /**
   * Run health checks on all containers
   */
  private async runHealthChecks(): Promise<void> {
    this.log.debug({ poolSize: this.pool.size }, 'Running health checks');

    const checks: Promise<void>[] = [];

    for (const pooled of this.pool.values()) {
      checks.push(
        (async () => {
          try {
            // Simple health check - try to execute a basic command
            const result = await pooled.container.exec(['echo', 'healthy'], {
              timeout: 2000,
            });

            if (result.exitCode === 0) {
              pooled.healthy = true;
            } else {
              pooled.healthy = false;
              this.log.warn(
                { containerId: pooled.container.id },
                'Container failed health check'
              );
            }
          } catch (error: any) {
            pooled.healthy = false;
            this.log.warn(
              { containerId: pooled.container.id, error: error.message },
              'Container health check failed'
            );

            // Remove unhealthy container
            await this.destroyContainer(pooled.container);
          }
        })()
      );
    }

    await Promise.allSettled(checks);

    const stats = this.getStats();
    this.log.debug(
      { healthy: stats.healthy, unhealthy: stats.unhealthy },
      'Health checks completed'
    );
  }
}
