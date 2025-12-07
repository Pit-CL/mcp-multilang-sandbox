/**
 * Path Validator - Prevents path traversal attacks
 *
 * Validates and sanitizes file paths to ensure they remain
 * within the allowed workspace directory.
 */

import * as path from 'path';

// Workspace root - all paths must resolve to be under this
const WORKSPACE_ROOT = '/workspace';

// Blocked path prefixes - never allow access to these
const BLOCKED_PATHS = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/root',
  '/home',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/boot',
  '/opt',
  '/run',
  '/srv',
  '/mnt',
  '/media',
];

// Custom security error
export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSecurityError';
  }
}

/**
 * Sanitize and validate a user-provided path
 *
 * @param userPath - The path provided by the user
 * @returns The sanitized absolute path within /workspace
 * @throws PathSecurityError if path traversal is detected
 */
export function sanitizePath(userPath: string): string {
  // 1. Check for null bytes (C-string termination attacks)
  if (userPath.includes('\x00') || userPath.includes('\0')) {
    throw new PathSecurityError('Null byte detected in path');
  }

  // 2. URL decode to catch encoded traversal attempts
  // Handle double encoding: %252e%252e -> %2e%2e -> ..
  let decoded = userPath;
  try {
    // Decode up to 3 times to catch multi-level encoding
    for (let i = 0; i < 3; i++) {
      const newDecoded = decodeURIComponent(decoded);
      if (newDecoded === decoded) break;
      decoded = newDecoded;
    }
  } catch {
    // Invalid encoding - use original
    decoded = userPath;
  }

  // 3. Check for obvious traversal patterns before normalization
  const traversalPatterns = [
    /\.\./,           // ../
    /\.\.\\/, // ..\
    /%2e%2e/i,        // URL encoded ..
    /%252e/i,         // Double encoded .
    /\.\./,           // Unicode dots
  ];

  for (const pattern of traversalPatterns) {
    if (pattern.test(decoded)) {
      throw new PathSecurityError('Path traversal pattern detected');
    }
  }

  // 4. Normalize the path
  // If path starts with /, treat it as relative to workspace anyway
  let normalized: string;
  if (decoded.startsWith('/')) {
    // Strip leading slash and join with workspace
    const relativePath = decoded.replace(/^\/+/, '');
    normalized = path.normalize(path.join(WORKSPACE_ROOT, relativePath));
  } else {
    normalized = path.normalize(path.join(WORKSPACE_ROOT, decoded));
  }

  // 5. Resolve to absolute path and verify it's under workspace
  const resolved = path.resolve(normalized);

  // Must be exactly /workspace or start with /workspace/
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + '/')) {
    throw new PathSecurityError(
      `Path escapes workspace: resolved to "${resolved}"`
    );
  }

  // 6. Check against blocked paths (shouldn't happen if above check works, but defense in depth)
  for (const blocked of BLOCKED_PATHS) {
    if (resolved === blocked || resolved.startsWith(blocked + '/')) {
      throw new PathSecurityError(`Access to ${blocked} is prohibited`);
    }
  }

  // 7. Check for symlink escape attempts in the path components
  // Note: This checks the path string, actual symlink resolution happens at runtime
  const pathComponents = resolved.split('/').filter(Boolean);
  for (const component of pathComponents) {
    // Block hidden files starting with .. or suspicious names
    if (component.startsWith('..') || component === '.') {
      throw new PathSecurityError('Invalid path component detected');
    }
  }

  return resolved;
}

/**
 * Validate that a path is safe for the specified operation
 *
 * @param userPath - The path provided by the user
 * @param operation - The operation being performed
 * @returns The sanitized path
 */
export function validatePathForOperation(
  userPath: string,
  operation: 'read' | 'write' | 'list' | 'delete'
): string {
  const sanitized = sanitizePath(userPath);

  // Additional restrictions based on operation
  if (operation === 'delete') {
    // Prevent deletion of workspace root
    if (sanitized === WORKSPACE_ROOT) {
      throw new PathSecurityError('Cannot delete workspace root');
    }
  }

  if (operation === 'write') {
    // Prevent writing to workspace root (it's a directory)
    if (sanitized === WORKSPACE_ROOT) {
      throw new PathSecurityError('Cannot write to workspace root directory');
    }
  }

  return sanitized;
}

/**
 * Check if a path is within workspace without throwing
 *
 * @param userPath - The path to check
 * @returns true if path is safe, false otherwise
 */
export function isPathSafe(userPath: string): boolean {
  try {
    sanitizePath(userPath);
    return true;
  } catch {
    return false;
  }
}
