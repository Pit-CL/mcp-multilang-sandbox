/**
 * RustRuntime - Runtime manager for Rust code execution
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

export class RustRuntime extends RuntimeManager {
  public readonly language: Language = 'rust';
  public readonly defaultImage = 'rust:1.75-alpine';
  public readonly packageManager: PackageManager = 'cargo';

  /**
   * Dangerous Rust patterns to block
   */
  private readonly BLOCKLIST = [
    /use\s+std::process/,
    /use\s+std::os/,
    /Command::/,
    /unsafe\s*\{/,
  ];

  /**
   * Execute Rust code using rustc
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
      const tempFile = this.getTempFilePath('.rs');
      const binaryFile = this.getTempFilePath('');

      // Wrap code in main function if not present
      const wrappedCode = this.wrapInMain(code);

      // Write code to file
      await context.container.putFile(tempFile, wrappedCode);

      // Compile with rustc
      const compileResult = await context.container.exec(
        ['rustc', tempFile, '-o', binaryFile],
        {
          timeout: context.timeout || 30000,
          workingDir: context.cwd || '/workspace',
        }
      );

      if (compileResult.exitCode !== 0) {
        return {
          stdout: compileResult.stdout,
          stderr: `Compilation failed:\n${compileResult.stderr}`,
          exitCode: compileResult.exitCode,
          duration: Date.now() - startTime,
        };
      }

      // Execute binary
      const result = await context.container.exec(
        [binaryFile],
        {
          timeout: context.timeout,
          env: context.env,
          stdin: context.stdin,
          workingDir: context.cwd || '/workspace',
        }
      );

      const duration = Date.now() - startTime;

      // Clean up temp files
      await context.container.deleteFile(tempFile).catch(() => {});
      await context.container.deleteFile(binaryFile).catch(() => {});

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
      };
    } catch (error: any) {
      throw new Error(`Rust execution failed: ${error.message}`);
    }
  }

  /**
   * Install packages using cargo
   */
  public async installPackages(
    packages: string[],
    container: Container
  ): Promise<InstallResult> {
    const startTime = Date.now();

    try {
      this.log.info({ packages, language: 'rust' }, 'Installing packages');

      // Validate package names
      this.validatePackageNames(packages);

      // Initialize Cargo.toml if needed
      const cargoTomlExists = await container.exec(['test', '-f', 'Cargo.toml']);

      if (cargoTomlExists.exitCode !== 0) {
        const cargoToml = `[package]
name = "sandbox"
version = "0.1.0"
edition = "2021"

[dependencies]
`;
        await container.putFile('/workspace/Cargo.toml', cargoToml);
      }

      // Add packages to Cargo.toml
      for (const pkg of packages) {
        const result = await container.exec([
          'sh',
          '-c',
          `cargo add ${pkg}`,
        ]);

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
   * Build Dockerfile for Rust runtime
   */
  public buildDockerfile(packages?: string[]): string {
    const baseDockerfile = `
FROM rust:1.75-alpine

# Install build tools
RUN apk add --no-cache musl-dev

# Pre-install common crates
RUN cargo install cargo-edit

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

CMD ["rustc"]
`;

    if (packages && packages.length > 0) {
      const packageList = packages.join(' ');
      return baseDockerfile + `\n# Install additional packages\nRUN cargo install ${packageList}\n`;
    }

    return baseDockerfile;
  }

  /**
   * Validate Rust code
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
   * Wrap code in main function if needed
   */
  private wrapInMain(code: string): string {
    // If code already has main function, use as-is
    if (/fn\s+main\s*\(\s*\)/.test(code)) {
      return code;
    }

    // Wrap in main function
    return `fn main() {
${code.split('\n').map(line => '    ' + line).join('\n')}
}`;
  }

  /**
   * Validate package names
   */
  private validatePackageNames(packages: string[]): void {
    const PACKAGE_BLOCKLIST = [
      'std::process',
      'std::os',
    ];

    for (const pkg of packages) {
      if (PACKAGE_BLOCKLIST.some(blocked => pkg.includes(blocked))) {
        throw new SecurityError(`Package "${pkg}" is not allowed`);
      }

      // Basic validation (Rust crate names)
      if (!/^[a-zA-Z0-9_-]+$/.test(pkg)) {
        throw new SecurityError(`Invalid package name: ${pkg}`);
      }
    }
  }
}
