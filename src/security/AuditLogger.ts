/**
 * AuditLogger - Security audit logging for sandbox operations
 *
 * Tracks all code executions, package installations, and security events
 * for compliance and forensic analysis.
 */

import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Language } from '../types/index.js';

// Audit event types
export type AuditEventType =
  | 'EXECUTE_START'
  | 'EXECUTE_END'
  | 'EXECUTE_ERROR'
  | 'EXECUTE_TIMEOUT'
  | 'EXECUTE_BLOCKED'
  | 'SESSION_CREATE'
  | 'SESSION_DESTROY'
  | 'SESSION_PAUSE'
  | 'SESSION_RESUME'
  | 'PACKAGE_INSTALL'
  | 'PACKAGE_INSTALL_BLOCKED'
  | 'FILE_READ'
  | 'FILE_WRITE'
  | 'FILE_DELETE'
  | 'SECURITY_VIOLATION'
  | 'CONTAINER_CREATE'
  | 'CONTAINER_DESTROY'
  | 'POOL_ACQUIRE'
  | 'POOL_RELEASE';

// Severity levels
export type AuditSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

// Audit event structure
export interface AuditEvent {
  timestamp: string;
  eventId: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  language?: Language;
  sessionId?: string;
  containerId?: string;
  userId?: string;
  sourceIp?: string;
  details: Record<string, unknown>;
  duration?: number;
  success: boolean;
  errorMessage?: string;
}

// Audit statistics
export interface AuditStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<AuditSeverity, number>;
  securityViolations: number;
  blockedExecutions: number;
  avgExecutionTime: number;
  lastHourEvents: number;
}

export class AuditLogger {
  private static instance: AuditLogger;
  private logStream: NodeJS.WritableStream | null = null;
  private events: AuditEvent[] = [];
  private maxInMemoryEvents = 1000;
  private logDir: string;
  private enabled: boolean = true;
  private consoleOutput: boolean = false;

  private constructor() {
    this.logDir = join(homedir(), '.claude', 'mcp-servers', 'multilang-pro', 'logs');
    this.ensureLogDir();
    this.initLogStream();
  }

  public static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private initLogStream(): void {
    const today = new Date().toISOString().split('T')[0];
    const logFile = join(this.logDir, `audit-${today}.jsonl`);

    try {
      this.logStream = createWriteStream(logFile, { flags: 'a' });
    } catch (error) {
      console.error('Failed to create audit log stream:', error);
    }
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Log an audit event
   */
  public log(
    eventType: AuditEventType,
    details: Record<string, unknown>,
    options: {
      language?: Language;
      sessionId?: string;
      containerId?: string;
      severity?: AuditSeverity;
      success?: boolean;
      duration?: number;
      errorMessage?: string;
    } = {}
  ): AuditEvent {
    const event: AuditEvent = {
      timestamp: new Date().toISOString(),
      eventId: this.generateEventId(),
      eventType,
      severity: options.severity || this.inferSeverity(eventType, options.success),
      language: options.language,
      sessionId: options.sessionId,
      containerId: options.containerId,
      details,
      duration: options.duration,
      success: options.success ?? true,
      errorMessage: options.errorMessage,
    };

    // Store in memory (circular buffer)
    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    // Write to file
    if (this.enabled && this.logStream) {
      this.logStream.write(JSON.stringify(event) + '\n');
    }

    // Console output for debugging
    if (this.consoleOutput) {
      this.printEvent(event);
    }

    return event;
  }

  private inferSeverity(eventType: AuditEventType, success?: boolean): AuditSeverity {
    if (eventType === 'SECURITY_VIOLATION') return 'CRITICAL';
    if (eventType === 'EXECUTE_BLOCKED' || eventType === 'PACKAGE_INSTALL_BLOCKED') return 'WARN';
    if (eventType === 'EXECUTE_ERROR' || eventType === 'EXECUTE_TIMEOUT') return 'ERROR';
    if (success === false) return 'ERROR';
    return 'INFO';
  }

  private printEvent(event: AuditEvent): void {
    const colors: Record<AuditSeverity, string> = {
      INFO: '\x1b[36m',    // Cyan
      WARN: '\x1b[33m',    // Yellow
      ERROR: '\x1b[31m',   // Red
      CRITICAL: '\x1b[35m', // Magenta
    };
    const reset = '\x1b[0m';
    const color = colors[event.severity];

    console.log(
      `${color}[AUDIT ${event.severity}]${reset} ${event.eventType} ` +
      `${event.language ? `(${event.language})` : ''} ` +
      `${event.duration ? `${event.duration}ms` : ''}`
    );
  }

  // ========== Convenience Methods ==========

  /**
   * Log code execution start
   */
  public logExecuteStart(
    language: Language,
    codeHash: string,
    sessionId?: string,
    containerId?: string
  ): AuditEvent {
    return this.log('EXECUTE_START', { codeHash, codeLength: codeHash.length }, {
      language,
      sessionId,
      containerId,
    });
  }

  /**
   * Log code execution end
   */
  public logExecuteEnd(
    language: Language,
    codeHash: string,
    duration: number,
    exitCode: number,
    sessionId?: string,
    containerId?: string
  ): AuditEvent {
    return this.log('EXECUTE_END', { codeHash, exitCode }, {
      language,
      sessionId,
      containerId,
      duration,
      success: exitCode === 0,
    });
  }

  /**
   * Log blocked execution (security)
   */
  public logExecuteBlocked(
    language: Language,
    reason: string,
    codeSnippet: string
  ): AuditEvent {
    return this.log('EXECUTE_BLOCKED', {
      reason,
      codeSnippet: codeSnippet.substring(0, 200), // Truncate for safety
    }, {
      language,
      severity: 'WARN',
      success: false,
    });
  }

  /**
   * Log security violation
   */
  public logSecurityViolation(
    type: string,
    details: Record<string, unknown>,
    language?: Language,
    containerId?: string
  ): AuditEvent {
    return this.log('SECURITY_VIOLATION', { type, ...details }, {
      language,
      containerId,
      severity: 'CRITICAL',
      success: false,
    });
  }

  /**
   * Log session creation
   */
  public logSessionCreate(
    sessionId: string,
    name: string,
    language: Language,
    ttl: number
  ): AuditEvent {
    return this.log('SESSION_CREATE', { name, ttl }, {
      sessionId,
      language,
    });
  }

  /**
   * Log session destruction
   */
  public logSessionDestroy(
    sessionId: string,
    reason: string
  ): AuditEvent {
    return this.log('SESSION_DESTROY', { reason }, {
      sessionId,
    });
  }

  /**
   * Log package installation
   */
  public logPackageInstall(
    language: Language,
    packages: string[],
    cached: boolean,
    duration: number,
    success: boolean
  ): AuditEvent {
    return this.log('PACKAGE_INSTALL', { packages, cached, packageCount: packages.length }, {
      language,
      duration,
      success,
    });
  }

  /**
   * Log blocked package installation
   */
  public logPackageBlocked(
    language: Language,
    packages: string[],
    reason: string
  ): AuditEvent {
    return this.log('PACKAGE_INSTALL_BLOCKED', { packages, reason }, {
      language,
      severity: 'WARN',
      success: false,
    });
  }

  /**
   * Log file operation
   */
  public logFileOp(
    operation: 'read' | 'write' | 'delete',
    path: string,
    sessionId: string,
    success: boolean
  ): AuditEvent {
    const eventType = operation === 'read' ? 'FILE_READ' :
                      operation === 'write' ? 'FILE_WRITE' : 'FILE_DELETE';
    return this.log(eventType, { path }, {
      sessionId,
      success,
    });
  }

  // ========== Statistics ==========

  /**
   * Get audit statistics
   */
  public getStats(): AuditStats {
    const now = Date.now();
    const hourAgo = now - 3600000;

    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<AuditSeverity, number> = {
      INFO: 0,
      WARN: 0,
      ERROR: 0,
      CRITICAL: 0,
    };

    let securityViolations = 0;
    let blockedExecutions = 0;
    let totalExecutionTime = 0;
    let executionCount = 0;
    let lastHourEvents = 0;

    for (const event of this.events) {
      // Count by type
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;

      // Count by severity
      eventsBySeverity[event.severity]++;

      // Security violations
      if (event.eventType === 'SECURITY_VIOLATION') {
        securityViolations++;
      }

      // Blocked executions
      if (event.eventType === 'EXECUTE_BLOCKED') {
        blockedExecutions++;
      }

      // Execution time
      if (event.eventType === 'EXECUTE_END' && event.duration) {
        totalExecutionTime += event.duration;
        executionCount++;
      }

      // Last hour
      if (new Date(event.timestamp).getTime() > hourAgo) {
        lastHourEvents++;
      }
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      eventsBySeverity,
      securityViolations,
      blockedExecutions,
      avgExecutionTime: executionCount > 0 ? Math.round(totalExecutionTime / executionCount) : 0,
      lastHourEvents,
    };
  }

  /**
   * Get recent events
   */
  public getRecentEvents(count: number = 50, filter?: {
    eventType?: AuditEventType;
    severity?: AuditSeverity;
    language?: Language;
  }): AuditEvent[] {
    let filtered = [...this.events];

    if (filter) {
      if (filter.eventType) {
        filtered = filtered.filter(e => e.eventType === filter.eventType);
      }
      if (filter.severity) {
        filtered = filtered.filter(e => e.severity === filter.severity);
      }
      if (filter.language) {
        filtered = filtered.filter(e => e.language === filter.language);
      }
    }

    return filtered.slice(-count);
  }

  /**
   * Get security events only
   */
  public getSecurityEvents(count: number = 50): AuditEvent[] {
    return this.events
      .filter(e =>
        e.eventType === 'SECURITY_VIOLATION' ||
        e.eventType === 'EXECUTE_BLOCKED' ||
        e.eventType === 'PACKAGE_INSTALL_BLOCKED' ||
        e.severity === 'CRITICAL'
      )
      .slice(-count);
  }

  // ========== Configuration ==========

  /**
   * Enable/disable logging
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Enable/disable console output
   */
  public setConsoleOutput(enabled: boolean): void {
    this.consoleOutput = enabled;
  }

  /**
   * Clear in-memory events
   */
  public clear(): void {
    this.events = [];
  }

  /**
   * Close log stream
   */
  public async close(): Promise<void> {
    if (this.logStream) {
      return new Promise((resolve) => {
        this.logStream!.end(() => resolve());
      });
    }
  }
}

// Export singleton
export const auditLogger = AuditLogger.getInstance();
