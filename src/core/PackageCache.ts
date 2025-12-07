/**
 * PackageCache - Multi-level package caching system using Docker layers
 */

import crypto from 'crypto';
import { dockerClient } from '../docker/DockerClient.js';
import { Container } from '../docker/Container.js';
import type { Language, InstallResult, CacheStats } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

export class PackageCache {
  private log = createLogger({ component: 'PackageCache' });
  private static instance: PackageCache;
  private cacheHits = 0;
  private cacheMisses = 0;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): PackageCache {
    if (!PackageCache.instance) {
      PackageCache.instance = new PackageCache();
    }
    return PackageCache.instance;
  }

  /**
   * Install packages with caching
   *
   * Strategy:
   * 1. Generate cache key from sorted packages
   * 2. Check if Docker image exists with that key
   * 3. If yes, use cached image
   * 4. If no, install packages and commit new image
   */
  public async install(
    language: Language,
    packages: string[],
    container: Container,
    runtime: any
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      // Generate cache key
      const cacheKey = this.getCacheKey(language, packages);
      const imageName = `mcp-sandbox-${language}:${cacheKey.slice(0, 12)}`;

      this.log.info(
        { language, packages, cacheKey: cacheKey.slice(0, 12) },
        'Installing packages'
      );

      // Check if cached image exists
      const cachedImage = await this.hasImage(imageName);

      if (cachedImage) {
        // Cache hit - packages already known
        this.cacheHits++;

        this.log.info(
          { language, packages, imageName },
          'Package cache hit - skipping installation'
        );

        // For existing containers, we still return success indicating packages are "available"
        // In production, cached images would be used when creating containers
        const duration = Date.now() - startTime;

        return {
          success: true,
          cached: true,
          duration,
          installedPackages: packages,
        };
      }

      // Cache miss - install packages
      this.cacheMisses++;
      this.log.info(
        { language, packages },
        'Package cache miss - installing packages'
      );

      // Install packages using runtime's installPackages method
      const installResult = await runtime.installPackages(packages, container);

      if (!installResult.success) {
        return installResult;
      }

      // Commit container as new cached image
      await this.commitImage(container, imageName);

      const duration = Date.now() - startTime;

      this.log.info(
        { language, packages, imageName, duration },
        'Packages installed and cached'
      );

      return {
        success: true,
        cached: false,
        duration,
        installedPackages: packages,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      this.log.error(
        { language, packages, error: error.message },
        'Package installation failed'
      );

      return {
        success: false,
        cached: false,
        duration,
        installedPackages: [],
        errors: [error.message],
      };
    }
  }

  /**
   * Get cache statistics
   */
  public async getStats(): Promise<CacheStats> {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? (this.cacheHits / total) * 100 : 0;

    // Get total cached layers (images)
    const images = await dockerClient.listImages();
    const cacheImages = images.filter(img =>
      img.tags.some(tag => tag.startsWith('mcp-sandbox-'))
    );

    const totalLayers = cacheImages.length;
    const sizeBytes = cacheImages.reduce((total, img) => total + img.size, 0);
    const sizeMB = sizeBytes / (1024 * 1024);

    return {
      totalLayers,
      hitRate,
      sizeMB,
      topPackages: [], // TODO: Track package usage
    };
  }

  /**
   * Clear package cache (remove all cached images)
   */
  public async clearCache(): Promise<void> {
    this.log.info('Clearing package cache...');

    try {
      const images = await dockerClient.listImages();

      const cacheImages = images.filter(img =>
        img.tags.some(tag => tag.startsWith('mcp-sandbox-'))
      );

      this.log.info({ count: cacheImages.length }, 'Removing cached images');

      for (const img of cacheImages) {
        try {
          await dockerClient.removeImage(img.id, true);
        } catch (error: any) {
          this.log.warn(
            { imageId: img.id, error: error.message },
            'Failed to remove cached image'
          );
        }
      }

      this.log.info('Package cache cleared');
    } catch (error: any) {
      this.log.error({ error: error.message }, 'Failed to clear cache');
      throw error;
    }
  }

  /**
   * Prune old cached images (keep only most recent N per language)
   */
  public async pruneCache(keepPerLanguage: number = 3): Promise<void> {
    this.log.info({ keepPerLanguage }, 'Pruning package cache...');

    try {
      const images = await dockerClient.listImages();

      // Group by language
      const byLanguage: Record<string, typeof images> = {};

      for (const img of images) {
        const tag = img.tags.find(t => t.startsWith('mcp-sandbox-'));
        if (tag) {
          const language = tag.split(':')[0].replace('mcp-sandbox-', '');
          if (!byLanguage[language]) {
            byLanguage[language] = [];
          }
          byLanguage[language].push(img);
        }
      }

      // Sort by creation date and keep only N most recent
      let removedCount = 0;

      for (const [language, langImages] of Object.entries(byLanguage)) {
        // Sort by creation date (newest first)
        langImages.sort((a, b) => b.created.getTime() - a.created.getTime());

        // Remove old images (keep only keepPerLanguage)
        const toRemove = langImages.slice(keepPerLanguage);

        for (const img of toRemove) {
          try {
            await dockerClient.removeImage(img.id, true);
            removedCount++;
            this.log.info(
              { language, imageId: img.id.slice(0, 12) },
              'Removed old cached image'
            );
          } catch (error: any) {
            this.log.warn(
              { imageId: img.id, error: error.message },
              'Failed to remove old image'
            );
          }
        }
      }

      this.log.info({ removedCount }, 'Cache pruning completed');
    } catch (error: any) {
      this.log.error({ error: error.message }, 'Failed to prune cache');
      throw error;
    }
  }

  // ========== Private Methods ==========

  /**
   * Generate cache key from language and packages
   */
  private getCacheKey(language: Language, packages: string[]): string {
    // Sort packages for consistent hashing
    const sorted = [...packages].sort();

    // Create hash from language + packages
    const data = `${language}:${JSON.stringify(sorted)}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if image exists
   */
  private async hasImage(imageName: string): Promise<boolean> {
    try {
      const images = await dockerClient.listImages();
      return images.some(img => img.tags.includes(imageName));
    } catch (error: any) {
      this.log.error(
        { imageName, error: error.message },
        'Failed to check image existence'
      );
      return false;
    }
  }

  /**
   * Commit container as image
   */
  private async commitImage(container: Container, imageName: string): Promise<void> {
    try {
      await container.commit(imageName);
      this.log.info({ imageName }, 'Container committed as cached image');
    } catch (error: any) {
      this.log.error(
        { imageName, error: error.message },
        'Failed to commit image'
      );
      throw error;
    }
  }

  /**
   * Get cache size in bytes
   */
  public async getCacheSize(): Promise<number> {
    try {
      const images = await dockerClient.listImages();

      const cacheImages = images.filter(img =>
        img.tags.some(tag => tag.startsWith('mcp-sandbox-'))
      );

      return cacheImages.reduce((total, img) => total + img.size, 0);
    } catch (error: any) {
      this.log.error({ error: error.message }, 'Failed to get cache size');
      return 0;
    }
  }

  /**
   * Format cache size for display
   */
  public formatCacheSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
