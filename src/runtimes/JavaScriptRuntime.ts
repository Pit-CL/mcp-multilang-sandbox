/**
 * JavaScriptRuntime - Runtime manager for JavaScript code execution
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

export class JavaScriptRuntime extends RuntimeManager {
  public readonly language: Language = 'javascript';
  public readonly defaultImage = 'node:20-alpine';
  public readonly packageManager: PackageManager = 'npm';

  /**
   * Dangerous JavaScript patterns to block
   */
  private readonly BLOCKLIST = [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"]fs['"]\s*\)/,
    /eval\s*\(/,
    /Function\s*\(/,
    /process\.exit/,
    /process\.kill/,
  ];

  /**
   * Execute JavaScript code using Node.js
   */
  public async execute(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate code
      this.validateCode(code);

      // Execute with node -e
      const result = await context.container.exec(
        ['node', '-e', code],
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
      throw new Error(`JavaScript execution failed: ${error.message}`);
    }
  }

  /**
   * Install packages using npm
   */
  public async installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      this.log.info({ packages, language: 'javascript' }, 'Installing packages');

      // Validate package names
      this.validatePackageNames(packages);

      // Initialize package.json if needed
      await container.exec(['sh', '-c', 'test -f package.json || npm init -y']);

      // Install packages
      const result = await container.exec([
        'npm',
        'install',
        '--no-save',
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
   * Build Dockerfile for JavaScript runtime
   */
  public buildDockerfile(packages?: string[]): string {
    const baseDockerfile = `
FROM node:20-alpine

# Pre-install common packages globally
RUN npm install -g \\
    lodash \\
    axios \\
    date-fns

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

CMD ["node"]
`;

    if (packages && packages.length > 0) {
      const packageList = packages.join(' \\\n    ');
      return baseDockerfile + `\n# Install additional packages\nRUN npm install -g \\\n    ${packageList}\n`;
    }

    return baseDockerfile;
  }

  /**
   * Validate JavaScript code
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
