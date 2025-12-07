/**
 * Package Validator - Validates package names for security
 *
 * Prevents installation of dangerous packages and validates
 * package name format to prevent injection attacks.
 */

import { PathSecurityError } from './pathValidator.js';

// Re-export as PackageSecurityError for semantic clarity
export class PackageSecurityError extends PathSecurityError {
  constructor(message: string) {
    super(message);
    this.name = 'PackageSecurityError';
  }
}

// Blocked packages by language (lowercase normalized)
const BLOCKED_PACKAGES: Record<string, string[]> = {
  python: [
    'os',
    'subprocess',
    'sys',
    'ctypes',
    'socket',
    'multiprocessing',
    'asyncio.subprocess',
    'pty',
    'fcntl',
    'resource',
    'signal',
    'mmap',
  ],
  javascript: [
    'child_process',
    'fs',
    'net',
    'http',
    'https',
    'dgram',
    'cluster',
    'worker_threads',
    'vm',
    'v8',
    'process',
    'os',
  ],
  typescript: [
    'child_process',
    'fs',
    'net',
    'http',
    'https',
    'dgram',
    'cluster',
    'worker_threads',
    'vm',
    'v8',
    'process',
    'os',
  ],
  bash: [
    'docker',
    'podman',
    'kubectl',
    'sudo',
    'su',
    'doas',
    'pkexec',
  ],
  go: [
    'os/exec',
    'syscall',
    'unsafe',
    'plugin',
    'runtime/cgo',
  ],
  rust: [
    'std::process',
    'std::os',
    'libc',
    'nix',
  ],
};

// Regex patterns for valid package names by language
const VALID_PACKAGE_PATTERNS: Record<string, RegExp> = {
  python: /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
  javascript: /^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
  typescript: /^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
  go: /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/,
  rust: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
  bash: /^[a-zA-Z0-9][a-zA-Z0-9._+@-]*$/,
};

/**
 * Validate a list of package names for a specific language
 *
 * @param language - The programming language
 * @param packages - Array of package names to validate
 * @throws PackageSecurityError if any package is invalid or blocked
 */
export function validatePackages(language: string, packages: string[]): void {
  const blocked = BLOCKED_PACKAGES[language] || [];
  const pattern = VALID_PACKAGE_PATTERNS[language];

  for (const pkg of packages) {
    // 1. Normalize package name (remove version specifiers, lowercase for comparison)
    const normalized = extractPackageName(pkg).toLowerCase();

    // 2. Check blocklist
    if (blocked.includes(normalized)) {
      throw new PackageSecurityError(
        `Package "${pkg}" is blocked for security reasons`
      );
    }

    // 3. Check for partial blocklist matches (e.g., "os.path" matches "os")
    for (const blockedPkg of blocked) {
      if (normalized.startsWith(blockedPkg + '.') || normalized.startsWith(blockedPkg + '/')) {
        throw new PackageSecurityError(
          `Package "${pkg}" is blocked (submodule of blocked package "${blockedPkg}")`
        );
      }
    }

    // 4. Block git URLs and remote sources
    if (pkg.includes('git+') || pkg.includes('://') || pkg.includes('@git')) {
      throw new PackageSecurityError(
        'Git URLs and remote package sources are not allowed'
      );
    }

    // 5. Block local file paths
    if (pkg.startsWith('/') || pkg.startsWith('./') || pkg.startsWith('../')) {
      throw new PackageSecurityError(
        'Local file paths are not allowed as package sources'
      );
    }

    // 6. Block shell metacharacters (injection prevention)
    const shellMetachars = /[;&|`$(){}[\]<>!'"\\]/;
    if (shellMetachars.test(pkg)) {
      throw new PackageSecurityError(
        `Shell metacharacters not allowed in package name: ${pkg}`
      );
    }

    // 7. Validate against language-specific pattern
    const nameOnly = extractPackageName(pkg);
    if (pattern && !pattern.test(nameOnly)) {
      throw new PackageSecurityError(
        `Invalid package name format for ${language}: ${pkg}`
      );
    }

    // 8. Check maximum length (prevent buffer overflow attempts)
    if (pkg.length > 200) {
      throw new PackageSecurityError(
        `Package name too long (max 200 characters): ${pkg.substring(0, 50)}...`
      );
    }
  }
}

/**
 * Extract the base package name from a version-specified string
 *
 * Examples:
 * - "package==1.0.0" -> "package"
 * - "package>=2.0" -> "package"
 * - "package[extra]" -> "package"
 * - "@scope/package@1.0.0" -> "@scope/package"
 */
function extractPackageName(pkg: string): string {
  // Remove version specifiers
  let name = pkg
    .replace(/[=<>!~]=?.*$/, '')  // ==, >=, <=, !=, ~=
    .replace(/@[\d.]+.*$/, '')     // @1.0.0
    .replace(/\[.*\]$/, '');       // [extras]

  // For scoped packages (@scope/name), preserve the scope
  if (name.startsWith('@') && name.includes('/')) {
    return name;
  }

  return name;
}

/**
 * Check if a package name is safe without throwing
 *
 * @param language - The programming language
 * @param pkg - Package name to check
 * @returns true if package is safe, false otherwise
 */
export function isPackageSafe(language: string, pkg: string): boolean {
  try {
    validatePackages(language, [pkg]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filter a list of packages, returning only safe ones
 *
 * @param language - The programming language
 * @param packages - Array of package names
 * @returns Array of safe package names
 */
export function filterSafePackages(language: string, packages: string[]): string[] {
  return packages.filter(pkg => isPackageSafe(language, pkg));
}
