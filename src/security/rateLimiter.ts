/**
 * Rate Limiter - Prevents abuse through request throttling
 *
 * Implements a sliding window rate limiter to protect against:
 * - DoS attacks via rapid requests
 * - Resource exhaustion
 * - Abuse of sandbox resources
 */

export interface RateLimitConfig {
  // Maximum requests allowed in the window
  maxRequests: number;
  // Time window in milliseconds
  windowMs: number;
  // Optional: different limits per operation type
  operationLimits?: Record<string, { maxRequests: number; windowMs: number }>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterMs?: number;
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxRequests: config.maxRequests ?? 20,
      windowMs: config.windowMs ?? 60000, // 1 minute default
      operationLimits: config.operationLimits,
    };

    // Cleanup old entries periodically
    setInterval(() => this.cleanup(), this.config.windowMs);
  }

  /**
   * Check if a request should be allowed
   *
   * @param key - Identifier for the requester (e.g., session name, IP)
   * @param operation - Optional operation type for per-operation limits
   * @returns RateLimitResult with allowed status and metadata
   */
  check(key: string, operation?: string): RateLimitResult {
    const now = Date.now();
    const limit = this.getLimit(operation);
    const windowStart = now - limit.windowMs;

    // Get or create request history for this key
    const fullKey = operation ? `${key}:${operation}` : key;
    let timestamps = this.requests.get(fullKey) || [];

    // Remove expired timestamps
    timestamps = timestamps.filter(t => t > windowStart);

    // Calculate result
    const remaining = Math.max(0, limit.maxRequests - timestamps.length);
    const oldestRequest = timestamps[0] || now;
    const resetAt = new Date(oldestRequest + limit.windowMs);

    if (timestamps.length >= limit.maxRequests) {
      // Rate limited
      const retryAfterMs = oldestRequest + limit.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs,
      };
    }

    // Allow request and record timestamp
    timestamps.push(now);
    this.requests.set(fullKey, timestamps);

    return {
      allowed: true,
      remaining: remaining - 1,
      resetAt,
    };
  }

  /**
   * Check if request is allowed (simple boolean version)
   */
  isAllowed(key: string, operation?: string): boolean {
    return this.check(key, operation).allowed;
  }

  /**
   * Consume a request slot (for pre-authorization scenarios)
   *
   * @returns true if consumed, false if rate limited
   */
  consume(key: string, operation?: string): boolean {
    return this.check(key, operation).allowed;
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(key: string, operation?: string): void {
    const fullKey = operation ? `${key}:${operation}` : key;
    this.requests.delete(fullKey);
  }

  /**
   * Get current usage for a key
   */
  getUsage(key: string, operation?: string): { current: number; limit: number; windowMs: number } {
    const now = Date.now();
    const limit = this.getLimit(operation);
    const windowStart = now - limit.windowMs;

    const fullKey = operation ? `${key}:${operation}` : key;
    const timestamps = this.requests.get(fullKey) || [];
    const current = timestamps.filter(t => t > windowStart).length;

    return {
      current,
      limit: limit.maxRequests,
      windowMs: limit.windowMs,
    };
  }

  /**
   * Get limit configuration for an operation
   */
  private getLimit(operation?: string): { maxRequests: number; windowMs: number } {
    if (operation && this.config.operationLimits?.[operation]) {
      return this.config.operationLimits[operation];
    }
    return {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const maxWindow = Math.max(
      this.config.windowMs,
      ...Object.values(this.config.operationLimits || {}).map(l => l.windowMs)
    );

    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter(t => now - t < maxWindow);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { totalKeys: number; totalRequests: number } {
    let totalRequests = 0;
    for (const timestamps of this.requests.values()) {
      totalRequests += timestamps.length;
    }
    return {
      totalKeys: this.requests.size,
      totalRequests,
    };
  }
}

// Default rate limiter instance with sensible defaults
export const defaultRateLimiter = new RateLimiter({
  maxRequests: 20,       // 20 requests per minute
  windowMs: 60000,       // 1 minute window
  operationLimits: {
    'execute': { maxRequests: 30, windowMs: 60000 },    // Code execution
    'install': { maxRequests: 10, windowMs: 60000 },    // Package install
    'file_ops': { maxRequests: 50, windowMs: 60000 },   // File operations
    'session': { maxRequests: 20, windowMs: 60000 },    // Session management
  },
});
