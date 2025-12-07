/**
 * BashRuntime - Runtime manager for Bash/Shell script execution
 */

import { RuntimeManager } from './base/RuntimeManager.js';
import type {
  Language,
  PackageManager,
  ExecutionContext,
  ExecutionResult,
  InstallResult,
} from '../types/index.js';
import type { Container } from '../docker/Container.js';
import { SecurityError } from '../types/index.js';

export class BashRuntime extends RuntimeManager {
  public readonly language: Language = 'bash';
  public readonly defaultImage = 'alpine:latest';
  public readonly packageManager: PackageManager = 'apk';

  /**
   * Dangerous Bash patterns to block
   */
  private readonly BLOCKLIST = [
    /rm\s+-rf\s+\//,
    /dd\s+if=/,
    /:\(\)\{.*\}:/, // Fork bomb
    /mkfs\./,
    />\s*\/dev\/sd/,
    /curl.*\|\s*(sh|bash)/,
    /wget.*\|\s*(sh|bash)/,
  ];

  /**
   * Execute Bash code using sh -c
   */
  public async execute(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate code
      this.validateCode(code);

      // Execute with sh -c
      const result = await context.container.exec(
        ['sh', '-c', code],
        {
          timeout: context.timeout,
          env: context.env,
          stdin: context.stdin,
          workingDir: context.cwd || '/workspace',
        }
      );

      const duration = Date.now() - startTime;

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
      };
    } catch (error: any) {
      throw new Error(`Bash execution failed: ${error.message}`);
    }
  }

  /**
   * Install packages using apk
   */
  public async installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      this.log.info({ packages, language: 'bash' }, 'Installing packages');

      // Validate package names
      this.validatePackageNames(packages);

      // Update apk index
      await container.exec(['apk', 'update']);

      // Install packages
      const result = await container.exec([
        'apk',
        'add',
        '--no-cache',
        ...packages,
      ]);

      const duration = Date.now() - startTime;

      if (result.exitCode !== 0) {
        return {
          success: false,
          cached: false,
          duration,
          installedPackages: [],
          errors: [result.stderr],
        };
      }

      this.log.info({ packages, duration }, 'Packages installed successfully');

      return {
        success: true,
        cached: false,
        duration,
        installedPackages: packages,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

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
   * Build Dockerfile for Bash runtime
   */
  public buildDockerfile(packages?: string[]): string {
    const baseDockerfile = `
FROM alpine:latest

# Install common tools
RUN apk add --no-cache \\
    bash \\
    curl \\
    jq \\
    git

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

CMD ["/bin/sh"]
`;

    if (packages && packages.length > 0) {
      const packageList = packages.join(' \\\n    ');
      return baseDockerfile + `\n# Install additional packages\nRUN apk add --no-cache \\\n    ${packageList}\n`;
    }

    return baseDockerfile;
  }

  /**
   * Validate Bash code
   */
  protected validateCode(code: string): void {
    for (const pattern of this.BLOCKLIST) {
      if (pattern.test(code)) {
        throw new SecurityError(
          `Dangerous pattern detected: ${pattern.source}`
        );
      }
    }
  }

  /**
   * Validate package names
   */
  private validatePackageNames(packages: string[]): void {
    const PACKAGE_BLOCKLIST = [
      'docker',
      'podman',
    ];

    for (const pkg of packages) {
      if (PACKAGE_BLOCKLIST.includes(pkg.toLowerCase())) {
        throw new SecurityError(`Package "${pkg}" is not allowed`);
      }

      // Basic validation (Alpine package names)
      if (!/^[a-zA-Z0-9._+@-]+$/.test(pkg)) {
        throw new SecurityError(`Invalid package name: ${pkg}`);
      }
    }
  }
}
