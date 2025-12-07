/**
 * RuntimeManager - Abstract base class for language runtimes
 */

import type {
  Language,
  PackageManager,
  ExecutionContext,
  ExecutionResult,
  InstallResult,
} from '../../types/index.js';
import type { Container } from '../../docker/Container.js';
import { logger } from '../../utils/logger.js';

export abstract class RuntimeManager {
  protected log = logger.child({ component: this.constructor.name });

  /**
   * Language identifier
   */
  public abstract readonly language: Language;

  /**
   * Default Docker image for this runtime
   */
  public abstract readonly defaultImage: string;

  /**
   * Package manager used by this runtime
   */
  public abstract readonly packageManager: PackageManager;

  /**
   * Execute code in the runtime
   */
  public abstract execute(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult>;

  /**
   * Install packages in the container
   */
  public abstract installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult>;

  /**
   * Build Dockerfile for this runtime
   */
  public abstract buildDockerfile(packages?: string[]): string;

  /**
   * Validate code before execution (security)
   */
  protected abstract validateCode(code: string): void;

  /**
   * Get cache key for package set
   */
  protected getCacheKey(packages: string[]): string {
    const sorted = [...packages].sort();
    const hash = this.hashString(JSON.stringify(sorted));
    return `${this.language}-${hash}`;
  }

  /**
   * Simple string hash function
   */
  protected hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Escape shell string
   */
  protected escapeShell(str: string): string {
    return str.replace(/'/g, "'\\''");
  }

  /**
   * Create temporary file path
   *
   * Uses /workspace instead of /tmp because /tmp has noexec mount option
   * which prevents execution of compiled binaries and scripts.
   */
  protected getTempFilePath(extension: string = ''): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `/workspace/.exec-${timestamp}-${random}${extension}`;
  }
}
