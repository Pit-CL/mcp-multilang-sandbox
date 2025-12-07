/**
 * Container - High-level abstraction for Docker containers
 */

import type Docker from 'dockerode';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import tar from 'tar-stream';
import type {
  ExecOptions,
  ExecResult,
  LogOptions,
  ResourceUsage,
  Language,
} from '../types/index.js';

// Output size limits to prevent OOM attacks
const MAX_STDOUT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_STDERR_SIZE = 5 * 1024 * 1024;  // 5MB
const TRUNCATION_MESSAGE = '\n\n... [OUTPUT TRUNCATED - SIZE LIMIT EXCEEDED] ...\n';

export class Container {
  private container: Docker.Container;
  public readonly id: string;
  public readonly language: Language;
  private createdAt: Date;

  constructor(container: Docker.Container, language: Language) {
    this.container = container;
    this.id = container.id;
    this.language = language;
    this.createdAt = new Date();
  }

  /**
   * Start container
   */
  public async start(): Promise<void> {
    try {
      await this.container.start();
    } catch (error: any) {
      // Ignore if already started
      if (!error.message?.includes('already started')) {
        throw new Error(`Failed to start container: ${error.message}`);
      }
    }
  }

  /**
   * Stop container
   */
  public async stop(timeout: number = 10): Promise<void> {
    try {
      await this.container.stop({ t: timeout });
    } catch (error: any) {
      // Ignore if already stopped
      if (!error.message?.includes('already stopped') && !error.message?.includes('not running')) {
        throw new Error(`Failed to stop container: ${error.message}`);
      }
    }
  }

  /**
   * Pause container
   */
  public async pause(): Promise<void> {
    try {
      await this.container.pause();
    } catch (error: any) {
      throw new Error(`Failed to pause container: ${error.message}`);
    }
  }

  /**
   * Unpause container
   */
  public async unpause(): Promise<void> {
    try {
      await this.container.unpause();
    } catch (error: any) {
      throw new Error(`Failed to unpause container: ${error.message}`);
    }
  }

  /**
   * Remove container
   */
  public async remove(force: boolean = false): Promise<void> {
    try {
      await this.container.remove({ force, v: true });
    } catch (error: any) {
      throw new Error(`Failed to remove container: ${error.message}`);
    }
  }

  /**
   * Execute command in container
   */
  public async exec(cmd: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const startTime = Date.now();

    try {
      // Ensure container is running
      const state = await this.inspect();
      if (!state.State.Running) {
        await this.start();
      }

      // Create exec instance
      const exec = await this.container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: !!options.stdin,
        Env: options.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : undefined,
        WorkingDir: options.workingDir,
      });

      // Execute with timeout
      const execPromise = this.executeWithTimeout(exec, options.stdin, options.timeout);
      const result = await execPromise;

      const duration = Date.now() - startTime;

      // Get exit code
      const inspectResult = await exec.inspect();
      const exitCode = inspectResult.ExitCode || 0;

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode,
        duration,
      };
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error('Execution timeout');
      }

      throw new Error(`Failed to execute command: ${error.message}`);
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout(
    exec: Docker.Exec,
    stdin?: string,
    timeout: number = 30000
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Execution timeout'));
      }, timeout);

      try {
        const stream = await exec.start({
          hijack: true,
          stdin: !!stdin,
        });

        // Send stdin if provided
        if (stdin) {
          stream.write(stdin);
          stream.end();
        }

        let stdout = '';
        let stderr = '';

        // Demux stdout/stderr
        this.container.modem.demuxStream(
          stream,
          {
            write: (chunk: Buffer) => {
              stdout += chunk.toString();
            },
          } as any,
          {
            write: (chunk: Buffer) => {
              stderr += chunk.toString();
            },
          } as any
        );

        stream.on('end', () => {
          clearTimeout(timer);
          resolve({ stdout, stderr });
        });

        stream.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Put file into container
   */
  public async putFile(path: string, content: string | Buffer): Promise<void> {
    try {
      // Create tar archive
      const pack = tar.pack();

      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');

      pack.entry({ name: path.split('/').pop() || 'file', size: buffer.length }, buffer);
      pack.finalize();

      // Extract directory from path
      const dir = path.substring(0, path.lastIndexOf('/')) || '/';

      // Put archive into container
      await this.container.putArchive(pack, { path: dir });
    } catch (error: any) {
      throw new Error(`Failed to put file: ${error.message}`);
    }
  }

  /**
   * Get file from container
   */
  public async getFile(path: string): Promise<Buffer> {
    try {
      const stream = await this.container.getArchive({ path });

      return new Promise((resolve, reject) => {
        const extract = tar.extract();
        const chunks: Buffer[] = [];

        extract.on('entry', (_header, entryStream, next) => {
          entryStream.on('data', (chunk) => {
            chunks.push(chunk);
          });

          entryStream.on('end', () => {
            next();
          });

          entryStream.resume();
        });

        extract.on('finish', () => {
          resolve(Buffer.concat(chunks));
        });

        extract.on('error', reject);

        stream.pipe(extract);
      });
    } catch (error: any) {
      throw new Error(`Failed to get file: ${error.message}`);
    }
  }

  /**
   * List files in container directory
   */
  public async listFiles(path: string): Promise<string[]> {
    try {
      const result = await this.exec(['ls', '-1', path]);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }

      return result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } catch (error: any) {
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  /**
   * Delete file from container
   */
  public async deleteFile(path: string): Promise<void> {
    try {
      const result = await this.exec(['rm', '-f', path]);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }
    } catch (error: any) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Upload file from host to container
   */
  public async uploadFile(localPath: string, containerPath: string): Promise<void> {
    try {
      const pack = tar.pack();

      // Read local file
      const readStream = createReadStream(localPath);
      const chunks: Buffer[] = [];

      readStream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));

      await new Promise<void>((resolve, reject) => {
        readStream.on('end', () => resolve());
        readStream.on('error', reject);
      });

      const buffer = Buffer.concat(chunks);
      const fileName = localPath.split('/').pop() || 'file';

      pack.entry({ name: fileName, size: buffer.length }, buffer);
      pack.finalize();

      const dir = containerPath.substring(0, containerPath.lastIndexOf('/')) || '/';
      await this.container.putArchive(pack, { path: dir });
    } catch (error: any) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Download file from container to host
   */
  public async downloadFile(containerPath: string, localPath: string): Promise<void> {
    try {
      const stream = await this.container.getArchive({ path: containerPath });
      const writeStream = createWriteStream(localPath);

      const extract = tar.extract();

      extract.on('entry', (_header, entryStream, next) => {
        entryStream.pipe(writeStream);
        entryStream.on('end', next);
      });

      await pipeline(stream, extract);
    } catch (error: any) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Get container logs
   */
  public async logs(options: LogOptions = {}): Promise<string> {
    try {
      const logOptions: any = {
        stdout: options.stdout ?? true,
        stderr: options.stderr ?? true,
        follow: false, // Always false for promise-based logs
        tail: options.tail,
        since: options.since ? Math.floor(options.since.getTime() / 1000) : undefined,
        until: options.until ? Math.floor(options.until.getTime() / 1000) : undefined,
      };

      const logBuffer: any = await this.container.logs(logOptions);

      return (logBuffer as Buffer).toString('utf-8');
    } catch (error: any) {
      throw new Error(`Failed to get logs: ${error.message}`);
    }
  }

  /**
   * Get container stats
   */
  public async stats(): Promise<ResourceUsage> {
    try {
      const stats = await this.container.stats({ stream: false });

      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuCount = stats.cpu_stats.online_cpus || 1;

      const cpuUsage = (cpuDelta / systemDelta) * cpuCount * 100;
      const memoryUsage = stats.memory_stats.usage || 0;

      return {
        cpuTimeMs: cpuUsage * 10, // Approximate
        memoryPeakMB: memoryUsage / (1024 * 1024),
        diskReadMB: (stats.blkio_stats?.io_service_bytes_recursive?.[0]?.value || 0) / (1024 * 1024),
        diskWriteMB: (stats.blkio_stats?.io_service_bytes_recursive?.[1]?.value || 0) / (1024 * 1024),
      };
    } catch (error: any) {
      throw new Error(`Failed to get stats: ${error.message}`);
    }
  }

  /**
   * Commit container to image
   */
  public async commit(tag: string): Promise<string> {
    try {
      const image = await this.container.commit({
        repo: 'mcp-sandbox',
        tag,
      });

      return image.Id;
    } catch (error: any) {
      throw new Error(`Failed to commit container: ${error.message}`);
    }
  }

  /**
   * Inspect container
   */
  public async inspect(): Promise<Docker.ContainerInspectInfo> {
    try {
      return await this.container.inspect();
    } catch (error: any) {
      throw new Error(`Failed to inspect container: ${error.message}`);
    }
  }

  /**
   * Check if container is running
   */
  public async isRunning(): Promise<boolean> {
    try {
      const info = await this.inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  /**
   * Get container age
   */
  public getAge(): number {
    return Date.now() - this.createdAt.getTime();
  }

  /**
   * Get underlying Dockerode container
   */
  public getDockerContainer(): Docker.Container {
    return this.container;
  }
}
