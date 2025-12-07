/**
 * GoRuntime - Runtime manager for Go code execution
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

export class GoRuntime extends RuntimeManager {
  public readonly language: Language = 'go';
  public readonly defaultImage = 'golang:1.21-alpine';
  public readonly packageManager: PackageManager = 'go';

  /**
   * Dangerous Go patterns to block
   */
  private readonly BLOCKLIST = [
    /import\s+.*"os\/exec"/,
    /import\s+.*"syscall"/,
    /import\s+.*"unsafe"/,
    /exec\.Command/,
    /syscall\./,
  ];

  /**
   * Execute Go code using go run
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
      const tempFile = this.getTempFilePath('.go');

      // Wrap code in main package if not present
      const wrappedCode = this.wrapInMain(code);

      // Write code to file
      await context.container.putFile(tempFile, wrappedCode);

      // Execute with go run
      const result = await context.container.exec(
        ['go', 'run', tempFile],
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
      throw new Error(`Go execution failed: ${error.message}`);
    }
  }

  /**
   * Install packages using go get
   */
  public async installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      this.log.info({ packages, language: 'go' }, 'Installing packages');

      // Validate package names
      this.validatePackageNames(packages);

      // Initialize go.mod if needed
      await container.exec(['sh', '-c', 'test -f go.mod || go mod init sandbox']);

      // Install packages
      for (const pkg of packages) {
        const result = await container.exec(['go', 'get', pkg]);

        if (result.exitCode !== 0) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            cached: false,
            duration,
            installedPackages: [],
            errors: [result.stderr],
          };
        }
      }

      const duration = Date.now() - startTime;

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
   * Build Dockerfile for Go runtime
   */
  public buildDockerfile(packages?: string[]): string {
    const baseDockerfile = `
FROM golang:1.21-alpine

# Install build tools
RUN apk add --no-cache git

# Pre-install common packages
RUN go install github.com/gorilla/mux@latest && \\
    go install github.com/stretchr/testify@latest

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

CMD ["go"]
`;

    if (packages && packages.length > 0) {
      const installCommands = packages
        .map(pkg => `RUN go install ${pkg}`)
        .join('\n');
      return baseDockerfile + `\n# Install additional packages\n${installCommands}\n`;
    }

    return baseDockerfile;
  }

  /**
   * Validate Go code
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
   * Wrap code in main package if needed
   */
  private wrapInMain(code: string): string {
    // If code already has package declaration, use as-is
    if (/^\s*package\s+\w+/.test(code)) {
      return code;
    }

    // Wrap in package main with main function if needed
    if (!/func\s+main\s*\(\s*\)/.test(code)) {
      return `package main

import "fmt"

func main() {
${code.split('\n').map(line => '  ' + line).join('\n')}
}`;
    }

    // Add package main if missing
    return `package main\n\n${code}`;
  }

  /**
   * Validate package names
   */
  private validatePackageNames(packages: string[]): void {
    const PACKAGE_BLOCKLIST = [
      'os/exec',
      'syscall',
      'unsafe',
    ];

    for (const pkg of packages) {
      if (PACKAGE_BLOCKLIST.some(blocked => pkg.includes(blocked))) {
        throw new SecurityError(`Package "${pkg}" is not allowed`);
      }

      // Basic validation (Go packages are URLs)
      if (!/^[a-zA-Z0-9._\-/]+$/.test(pkg)) {
        throw new SecurityError(`Invalid package name: ${pkg}`);
      }
    }
  }
}
