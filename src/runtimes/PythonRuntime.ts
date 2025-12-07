/**
 * PythonRuntime - Runtime manager for Python code execution
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

export class PythonRuntime extends RuntimeManager {
  public readonly language: Language = 'python';
  public readonly defaultImage = 'python:3.11-slim';
  public readonly packageManager: PackageManager = 'pip';

  /**
   * Dangerous Python patterns to block
   */
  private readonly BLOCKLIST = [
    /import\s+os(?!\w)/,                    // import os
    /from\s+os\s+import/,                    // from os import
    /import\s+subprocess/,                   // import subprocess
    /from\s+subprocess\s+import/,            // from subprocess import
    /import\s+sys/,                          // import sys (potentially dangerous)
    /eval\s*\(/,                             // eval()
    /exec\s*\(/,                             // exec()
    /__import__\s*\(/,                       // __import__()
    /compile\s*\(/,                          // compile()
    /open\s*\([^)]*,\s*['"]w/,              // open() in write mode
    /open\s*\([^)]*,\s*['"]a/,              // open() in append mode
    /\.system\s*\(/,                         // .system()
    /\.popen\s*\(/,                          // .popen()
  ];

  /**
   * Execute Python code
   */
  public async execute(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate code for security
      this.validateCode(code);

      // Execute Python code
      const result = await context.container.exec(
        ['python', '-c', code],
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
      throw new Error(`Python execution failed: ${error.message}`);
    }
  }

  /**
   * Install Python packages using pip
   */
  public async installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      this.log.info({ packages, language: 'python' }, 'Installing packages');

      // Validate package names (basic sanitization)
      this.validatePackageNames(packages);

      // Create requirements content
      const requirements = packages.join('\n');

      // Write requirements to temp file
      await container.putFile('/tmp/requirements.txt', requirements);

      // Install packages
      const result = await container.exec([
        'pip',
        'install',
        '--no-cache-dir',
        '--disable-pip-version-check',
        '-r',
        '/tmp/requirements.txt',
      ]);

      const duration = Date.now() - startTime;

      if (result.exitCode !== 0) {
        this.log.error({ stderr: result.stderr }, 'Package installation failed');
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

      this.log.error({ error: error.message }, 'Package installation error');

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
   * Build Dockerfile for Python runtime
   */
  public buildDockerfile(packages?: string[]): string {
    const baseDockerfile = `
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc \\
    g++ \\
    make \\
    && rm -rf /var/lib/apt/lists/*

# Create cache directory
RUN mkdir -p /root/.cache/pip
VOLUME /root/.cache/pip

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Pre-install common packages
RUN pip install --no-cache-dir \\
    numpy \\
    pandas \\
    requests

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

# Set Python to unbuffered mode (better for logging)
ENV PYTHONUNBUFFERED=1

CMD ["python"]
`;

    if (packages && packages.length > 0) {
      const packageList = packages.join(' \\\n    ');
      return baseDockerfile + `\n# Install additional packages\nRUN pip install --no-cache-dir \\\n    ${packageList}\n`;
    }

    return baseDockerfile;
  }

  /**
   * Validate Python code for security
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
      'os',
      'subprocess',
      'sys',
    ];

    for (const pkg of packages) {
      // Check if package is in blocklist
      if (PACKAGE_BLOCKLIST.includes(pkg.toLowerCase())) {
        throw new SecurityError(`Package "${pkg}" is not allowed`);
      }

      // Check for suspicious characters
      if (!/^[a-zA-Z0-9._-]+$/.test(pkg)) {
        throw new SecurityError(`Invalid package name: ${pkg}`);
      }
    }
  }

  /**
   * Get recommended packages for data science
   */
  public static getDataSciencePackages(): string[] {
    return [
      'numpy',
      'pandas',
      'matplotlib',
      'scikit-learn',
      'scipy',
      'seaborn',
    ];
  }

  /**
   * Get recommended packages for web development
   */
  public static getWebPackages(): string[] {
    return [
      'requests',
      'beautifulsoup4',
      'flask',
      'fastapi',
      'aiohttp',
    ];
  }

  /**
   * Get recommended packages for ML/AI
   */
  public static getMLPackages(): string[] {
    return [
      'torch',
      'tensorflow',
      'transformers',
      'mlx', // For Mac M-series
    ];
  }
}
