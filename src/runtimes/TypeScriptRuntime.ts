/**
 * TypeScriptRuntime - Runtime manager for TypeScript code execution
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

export class TypeScriptRuntime extends RuntimeManager {
  public readonly language: Language = 'typescript';
  public readonly defaultImage = 'oven/bun:latest'; // Bun is fast for TS
  public readonly packageManager: PackageManager = 'pnpm';

  /**
   * Dangerous TypeScript/JavaScript patterns to block
   */
  private readonly BLOCKLIST = [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"]fs['"]\s*\)/,
    /import\s+.*\s+from\s+['"]child_process['"]/,
    /import\s+.*\s+from\s+['"]fs['"]/,
    /eval\s*\(/,
    /Function\s*\(/,
    /process\.exit/,
    /process\.kill/,
  ];

  /**
   * Execute TypeScript code using Bun
   */
  public async execute(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate code
      this.validateCode(code);

      // Create temporary file
      const tempFile = this.getTempFilePath('.ts');

      // Write code to file
      await context.container.putFile(tempFile, code);

      // Execute with bun (supports TS natively)
      const result = await context.container.exec(
        ['bun', 'run', tempFile],
        {
          timeout: context.timeout,
          env: context.env,
          stdin: context.stdin,
          workingDir: context.cwd || '/workspace',
        }
      );

      const duration = Date.now() - startTime;

      // Clean up temp file
      await context.container.deleteFile(tempFile).catch(() => {});

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
      };
    } catch (error: any) {
      throw new Error(`TypeScript execution failed: ${error.message}`);
    }
  }

  /**
   * Install packages using pnpm
   */
  public async installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      this.log.info({ packages, language: 'typescript' }, 'Installing packages');

      // Validate package names
      this.validatePackageNames(packages);

      // Initialize package.json if it doesn't exist
      await container.exec(['sh', '-c', 'test -f package.json || echo "{}" > package.json']);

      // Install packages
      const result = await container.exec([
        'pnpm',
        'add',
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
   * Build Dockerfile for TypeScript runtime
   */
  public buildDockerfile(packages?: string[]): string {
    const baseDockerfile = `
FROM oven/bun:latest

# Install pnpm
RUN npm install -g pnpm

# Create pnpm store directory
RUN mkdir -p /root/.pnpm-store
VOLUME /root/.pnpm-store

# Pre-install common packages
RUN pnpm add -g \\
    typescript \\
    @types/node \\
    zod \\
    axios

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

CMD ["bun"]
`;

    if (packages && packages.length > 0) {
      const packageList = packages.join(' \\\n    ');
      return baseDockerfile + `\n# Install additional packages\nRUN pnpm add -g \\\n    ${packageList}\n`;
    }

    return baseDockerfile;
  }

  /**
   * Validate TypeScript code
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
      'child_process',
      'fs',
      'node:child_process',
      'node:fs',
    ];

    for (const pkg of packages) {
      if (PACKAGE_BLOCKLIST.includes(pkg.toLowerCase())) {
        throw new SecurityError(`Package "${pkg}" is not allowed`);
      }

      // Basic validation
      if (!/^[@a-zA-Z0-9/_-]+$/.test(pkg)) {
        throw new SecurityError(`Invalid package name: ${pkg}`);
      }
    }
  }
}
