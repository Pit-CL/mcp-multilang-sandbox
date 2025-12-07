/**
 * DockerClient - Wrapper for Dockerode with error handling and retry logic
 */

import Docker from 'dockerode';
import type {
  ContainerConfig,
  ContainerFilters,
  ContainerStats,
  ImageInfo,
} from '../types/index.js';
import {
  getSeccompProfile,
  getResourceLimits,
  type SecurityLevel,
} from '../security/index.js';

export class DockerClient {
  private docker: Docker;
  private static instance: DockerClient;

  private constructor() {
    // Initialize Dockerode (auto-detects Docker socket)
    this.docker = new Docker();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DockerClient {
    if (!DockerClient.instance) {
      DockerClient.instance = new DockerClient();
    }
    return DockerClient.instance;
  }

  /**
   * Check Docker connection
   */
  public async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Docker info
   */
  public async getInfo(): Promise<any> {
    try {
      return await this.docker.info();
    } catch (error) {
      throw this.handleError(error, 'Failed to get Docker info');
    }
  }

  /**
   * Pull Docker image
   */
  public async pullImage(image: string, onProgress?: (progress: any) => void): Promise<void> {
    try {
      const stream = await this.docker.pull(image);

      return new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(
          stream,
          (err) => {
            if (err) reject(err);
            else resolve();
          },
          onProgress
        );
      });
    } catch (error) {
      throw this.handleError(error, `Failed to pull image: ${image}`);
    }
  }

  /**
   * Create container with security hardening
   */
  public async createContainer(
    config: ContainerConfig,
    securityLevel: SecurityLevel = 'standard'
  ): Promise<Docker.Container> {
    try {
      const limits = getResourceLimits(securityLevel);
      const seccompProfile = getSeccompProfile(config.language);

      const createOptions: Docker.ContainerCreateOptions = {
        Image: config.image,
        Labels: {
          'mcp-sandbox': 'true',
          'language': config.language,
          'security-level': securityLevel,
        },
        // Keep container running
        Cmd: ['/bin/sh', '-c', 'sleep infinity'],
        HostConfig: {
          // Memory limits
          Memory: this.parseMemory(config.memory || limits.memory),
          MemorySwap: this.parseMemory(config.memory || limits.memory),

          // CPU limits
          NanoCpus: this.parseCpus(config.cpus || limits.cpus),

          // Network isolation
          NetworkMode: config.network || 'none',

          // Process limits
          PidsLimit: limits.pidsLimit,

          // Security: No new privileges
          SecurityOpt: [
            'no-new-privileges:true',
            // Seccomp profile
            `seccomp=${JSON.stringify(seccompProfile)}`,
          ],

          // Capability dropping
          CapDrop: limits.capDrop,
          CapAdd: limits.capAdd,

          // Read-only root filesystem (if strict)
          ReadonlyRootfs: limits.readonlyRootfs,

          // Tmpfs for writable areas when rootfs is readonly
          ...(limits.readonlyRootfs && {
            Tmpfs: {
              '/tmp': 'rw,noexec,nosuid,size=64m',
              '/workspace': 'rw,noexec,nosuid,size=128m',
            },
          }),

          // Volume mounts
          Binds: config.volumes?.map(v =>
            `${v.hostPath}:${v.containerPath}${v.readonly ? ':ro' : ''}`
          ),

          // Ulimits for additional protection
          Ulimits: [
            { Name: 'nofile', Soft: 1024, Hard: 2048 },
            { Name: 'nproc', Soft: 64, Hard: 128 },
            { Name: 'core', Soft: 0, Hard: 0 }, // No core dumps
          ],

          AutoRemove: false,
        },
        Env: config.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`) : [],
        WorkingDir: '/workspace',
        Tty: false,
        OpenStdin: false,
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        // Run as non-root user
        User: '1000:1000',
      };

      // GPU support (if requested)
      if (config.gpu) {
        createOptions.HostConfig!.DeviceRequests = [
          {
            Driver: 'nvidia',
            Count: -1, // All GPUs
            Capabilities: [['gpu', 'compute', 'utility']],
          },
        ];
      }

      return await this.docker.createContainer(createOptions);
    } catch (error) {
      throw this.handleError(error, 'Failed to create container');
    }
  }

  /**
   * Get container by ID
   */
  public getContainer(id: string): Docker.Container {
    return this.docker.getContainer(id);
  }

  /**
   * List containers
   */
  public async listContainers(filters?: ContainerFilters): Promise<any[]> {
    try {
      const options: any = {
        all: true,
      };

      if (filters) {
        options.filters = {};

        if (filters.status) {
          options.filters.status = [filters.status];
        }

        if (filters.label) {
          options.filters.label = Object.entries(filters.label).map(
            ([k, v]) => `${k}=${v}`
          );
        }

        if (filters.limit) {
          options.limit = filters.limit;
        }
      }

      const result: any = await this.docker.listContainers(options);
      return result || [];
    } catch (error) {
      throw this.handleError(error, 'Failed to list containers');
    }
  }

  /**
   * Remove container
   */
  public async removeContainer(id: string, force: boolean = false): Promise<void> {
    try {
      const container = this.docker.getContainer(id);
      await container.remove({ force, v: true });
    } catch (error) {
      throw this.handleError(error, `Failed to remove container: ${id}`);
    }
  }

  /**
   * Get container stats
   */
  public async getStats(id: string): Promise<ContainerStats> {
    try {
      const container = this.docker.getContainer(id);
      const stats = await container.stats({ stream: false });

      return this.parseStats(stats);
    } catch (error) {
      throw this.handleError(error, `Failed to get stats for container: ${id}`);
    }
  }

  /**
   * List images
   */
  public async listImages(): Promise<ImageInfo[]> {
    try {
      const images = await this.docker.listImages();

      return images.map(img => ({
        id: img.Id,
        tags: img.RepoTags || [],
        size: img.Size,
        created: new Date(img.Created * 1000),
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to list images');
    }
  }

  /**
   * Remove image
   */
  public async removeImage(id: string, force: boolean = false): Promise<void> {
    try {
      const image = this.docker.getImage(id);
      await image.remove({ force });
    } catch (error) {
      throw this.handleError(error, `Failed to remove image: ${id}`);
    }
  }

  /**
   * Prune unused containers
   */
  public async pruneContainers(): Promise<{ containersDeleted: string[]; spaceReclaimed: number }> {
    try {
      const result = await this.docker.pruneContainers({
        filters: {
          label: ['mcp-sandbox=true'],
        },
      });

      return {
        containersDeleted: result.ContainersDeleted || [],
        spaceReclaimed: result.SpaceReclaimed || 0,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to prune containers');
    }
  }

  /**
   * Prune unused images
   */
  public async pruneImages(): Promise<{ imagesDeleted: string[]; spaceReclaimed: number }> {
    try {
      const result = await this.docker.pruneImages({
        filters: {
          dangling: { false: true },
        },
      });

      return {
        imagesDeleted: (result.ImagesDeleted || []).map(img => img.Deleted || img.Untagged || ''),
        spaceReclaimed: result.SpaceReclaimed || 0,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to prune images');
    }
  }

  // ========== Helper Methods ==========

  /**
   * Parse memory string to bytes
   */
  private parseMemory(memory: string): number {
    const units: Record<string, number> = {
      b: 1,
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024,
    };

    const match = memory.toLowerCase().match(/^(\d+)([bkmg])$/);
    if (!match) {
      throw new Error(`Invalid memory format: ${memory}`);
    }

    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }

  /**
   * Parse CPU string to nano CPUs
   */
  private parseCpus(cpus: string): number {
    const value = parseFloat(cpus);
    if (isNaN(value) || value <= 0) {
      throw new Error(`Invalid CPU format: ${cpus}`);
    }
    return Math.floor(value * 1e9);
  }

  /**
   * Parse container stats
   */
  private parseStats(stats: any): ContainerStats {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;

    const cpuUsage = (cpuDelta / systemDelta) * cpuCount * 100;

    return {
      cpuUsage: isNaN(cpuUsage) ? 0 : cpuUsage,
      memoryUsage: stats.memory_stats.usage || 0,
      memoryLimit: stats.memory_stats.limit || 0,
      networkRx: stats.networks?.eth0?.rx_bytes || 0,
      networkTx: stats.networks?.eth0?.tx_bytes || 0,
      blockRead: stats.blkio_stats?.io_service_bytes_recursive?.[0]?.value || 0,
      blockWrite: stats.blkio_stats?.io_service_bytes_recursive?.[1]?.value || 0,
      pids: stats.pids_stats?.current || 0,
    };
  }

  /**
   * Handle Docker errors
   */
  private handleError(error: any, message: string): Error {
    const errorMessage = error.message || error.toString();
    return new Error(`${message}: ${errorMessage}`);
  }
}

// Export singleton instance
export const dockerClient = DockerClient.getInstance();
