/**
 * Core types for MCP Multi-Language Sandbox
 */

// Supported programming languages
export type Language =
  | 'python'
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'rust'
  | 'bash'
  | 'ruby';

// Package managers
export type PackageManager = 'pip' | 'npm' | 'pnpm' | 'yarn' | 'go' | 'cargo' | 'gem' | 'apk';

// Execution context for running code
export interface ExecutionContext {
  container: any; // Will be typed properly when Container class is created
  timeout: number;
  env: Record<string, string>;
  stdin?: string;
  cwd?: string;
}

// Result of code execution
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  resourceUsage?: ResourceUsage;
}

// Resource usage statistics
export interface ResourceUsage {
  cpuTimeMs: number;
  memoryPeakMB: number;
  diskReadMB?: number;
  diskWriteMB?: number;
}

// Package installation result
export interface InstallResult {
  success: boolean;
  cached: boolean;
  duration: number;
  installedPackages: string[];
  errors?: string[];
}

// Container configuration
export interface ContainerConfig {
  image: string;
  language: Language;
  memory?: string;
  cpus?: string;
  network?: 'none' | 'bridge' | 'host';
  env?: Record<string, string>;
  volumes?: VolumeMount[];
  gpu?: boolean;
}

// Volume mount configuration
export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

// Container pool configuration
export interface PoolConfig {
  minIdle: number;
  maxActive: number;
  warmupLanguages: Language[];
  evictionPolicy: 'LRU' | 'TTL' | 'FIFO';
  healthCheckInterval: number;
  containerMemory?: string;
  containerCpus?: string;
}

// Pool statistics
export interface PoolStats {
  total: number;
  available: number;
  inUse: number;
  byLanguage: Record<Language, number>;
  healthy: number;
  unhealthy: number;
}

// Session configuration
export interface SessionConfig {
  language: Language;
  packages?: string[];
  env?: Record<string, string>;
  resources?: ResourceLimits;
  gpu?: boolean;
  persistent?: boolean;
  ttl?: number; // Time to live in seconds
}

// Session state
export type SessionState = 'active' | 'paused' | 'stopped';

// Session information
export interface Session {
  id: string;
  name: string;
  language: Language;
  container: any; // Will be typed when Container is created
  state: SessionState;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt?: Date;
  metadata: Record<string, any>;
}

// Session info for listing
export interface SessionInfo {
  id: string;
  name: string;
  language: Language;
  state: SessionState;
  createdAt: Date;
  lastUsedAt: Date;
}

// Resource limits
export interface ResourceLimits {
  memory?: string;
  memorySwap?: string;
  cpus?: string;
  pidsLimit?: number;
  diskQuota?: string;
}

// Snapshot information
export interface SnapshotInfo {
  id: string;
  sessionId: string;
  tag: string;
  createdAt: Date;
  sizeMB: number;
  files?: string[];
}

// Cache statistics
export interface CacheStats {
  totalLayers: number;
  hitRate: number;
  sizeMB: number;
  topPackages: Array<{ name: string; hits: number }>;
}

// Security configuration
export interface SecurityConfig {
  network: {
    mode: 'none' | 'bridge' | 'host';
    allowList: string[];
    maxConnections: number;
  };
  resources: ResourceLimits;
  security: {
    readonlyRootfs: boolean;
    noNewPrivileges: boolean;
    seccompProfile: string;
    capDrop: string[];
    capAdd: string[];
  };
  user: {
    uid: number;
    gid: number;
    name: string;
  };
}

// Docker image information
export interface ImageInfo {
  id: string;
  tags: string[];
  size: number;
  created: Date;
}

// Container filters
export interface ContainerFilters {
  status?: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  label?: Record<string, string>;
  limit?: number;
}

// Container statistics
export interface ContainerStats {
  cpuUsage: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

// Execution options
export interface ExecOptions {
  timeout?: number;
  env?: Record<string, string>;
  stdin?: string;
  workingDir?: string;
}

// Execution result from container exec
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

// Log options
export interface LogOptions {
  stdout?: boolean;
  stderr?: boolean;
  since?: Date;
  until?: Date;
  tail?: number;
  follow?: boolean;
}

// MCP Tool parameters
export interface ExecuteParams {
  language: Language;
  code: string;
  session?: string;
  timeout?: number;
  env?: Record<string, string>;
  stdin?: string;
}

export interface InstallPackagesParams {
  session: string;
  packages: string[];
  language?: Language;
}

export interface SessionParams {
  action: 'create' | 'list' | 'pause' | 'resume' | 'destroy' | 'snapshot';
  name?: string;
  language?: Language;
  packages?: string[];
  ttl?: number;
  tag?: string;
}

export interface FileOpsParams {
  session: string;
  operation: 'read' | 'write' | 'list' | 'delete' | 'upload' | 'download';
  path: string;
  content?: string;
  localPath?: string;
}

export interface InspectParams {
  target: 'sessions' | 'pool' | 'cache' | 'metrics';
  session?: string;
}

// Error types
export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

export class TimeoutError extends SandboxError {
  constructor(message: string = 'Execution timeout') {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class ResourceLimitError extends SandboxError {
  constructor(message: string = 'Resource limit exceeded') {
    super(message, 'RESOURCE_LIMIT');
    this.name = 'ResourceLimitError';
  }
}

export class SecurityError extends SandboxError {
  constructor(message: string = 'Security violation detected') {
    super(message, 'SECURITY');
    this.name = 'SecurityError';
  }
}

export class ContainerError extends SandboxError {
  constructor(message: string, details?: any) {
    super(message, 'CONTAINER_ERROR', details);
    this.name = 'ContainerError';
  }
}
