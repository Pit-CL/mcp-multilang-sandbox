/**
 * SessionManager - Manages persistent container sessions with TTL
 */

import { v4 as uuidv4 } from 'uuid';
import { dockerClient } from '../docker/DockerClient.js';
import { Container } from '../docker/Container.js';
import type { Language, Session, SessionConfig, SessionState } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionsByName: Map<string, string> = new Map(); // name -> id mapping
  private gcInterval?: NodeJS.Timeout;
  private log = createLogger({ component: 'SessionManager' });
  private static instance: SessionManager;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Initialize session manager
   */
  public async initialize(gcIntervalMs: number = 60000): Promise<void> {
    this.log.info('Initializing session manager...');

    // Start garbage collection
    this.startGarbageCollection(gcIntervalMs);

    this.log.info({ gcInterval: gcIntervalMs }, 'Session manager initialized');
  }

  /**
   * Create a new session
   */
  public async create(name: string, config: SessionConfig): Promise<Session> {
    try {
      // Check if session with this name already exists
      if (this.sessionsByName.has(name)) {
        const existingId = this.sessionsByName.get(name)!;
        const existing = this.sessions.get(existingId);
        if (existing) {
          throw new Error(`Session with name "${name}" already exists`);
        }
        // Clean up stale mapping
        this.sessionsByName.delete(name);
      }

      this.log.info({ name, config }, 'Creating new session');

      // Get default image for language
      const imageMap: Record<Language, string> = {
        python: 'python:3.11-slim',
        typescript: 'oven/bun:latest',
        javascript: 'node:20-alpine',
        go: 'golang:1.21-alpine',
        rust: 'rust:1.75-alpine',
        bash: 'alpine:latest',
        ruby: 'ruby:3.2-alpine',
      };

      const image = imageMap[config.language];

      // Create container
      const dockerContainer = await dockerClient.createContainer({
        image,
        language: config.language,
        memory: config.resources?.memory || '512m',
        cpus: config.resources?.cpus || '1.0',
        network: 'none', // Security
        env: config.env,
        gpu: config.gpu || false,
      });

      const container = new Container(dockerContainer, config.language);
      await container.start();

      // Create session
      const session: Session = {
        id: uuidv4(),
        name,
        language: config.language,
        container,
        state: 'active',
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: config.ttl ? new Date(Date.now() + config.ttl * 1000) : undefined,
        metadata: {
          packages: config.packages || [],
          env: config.env || {},
          gpu: config.gpu || false,
        },
      };

      // Store session
      this.sessions.set(session.id, session);
      this.sessionsByName.set(name, session.id);

      this.log.info(
        { sessionId: session.id, name, language: config.language },
        'Session created'
      );

      return session;
    } catch (error: any) {
      this.log.error({ name, error: error.message }, 'Failed to create session');
      throw error;
    }
  }

  /**
   * Get session by ID or name
   */
  public async get(nameOrId: string): Promise<Session | null> {
    // Try by ID first
    let session = this.sessions.get(nameOrId);

    // Try by name
    if (!session) {
      const id = this.sessionsByName.get(nameOrId);
      if (id) {
        session = this.sessions.get(id);
      }
    }

    if (session) {
      // Update last used time
      session.lastUsedAt = new Date();
    }

    return session || null;
  }

  /**
   * List all sessions
   */
  public async list(): Promise<Array<{
    id: string;
    name: string;
    language: Language;
    state: SessionState;
    createdAt: Date;
    lastUsedAt: Date;
    expiresAt?: Date;
  }>> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      name: session.name,
      language: session.language,
      state: session.state,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
    }));
  }

  /**
   * Pause a session (stop container, keep state)
   */
  public async pause(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state === 'paused') {
      this.log.info({ sessionId }, 'Session already paused');
      return;
    }

    try {
      this.log.info({ sessionId, name: session.name }, 'Pausing session');

      await session.container.pause();
      session.state = 'paused';

      this.log.info({ sessionId }, 'Session paused');
    } catch (error: any) {
      this.log.error(
        { sessionId, error: error.message },
        'Failed to pause session'
      );
      throw error;
    }
  }

  /**
   * Resume a paused session
   */
  public async resume(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== 'paused') {
      this.log.info({ sessionId, state: session.state }, 'Session not paused');
      return;
    }

    try {
      this.log.info({ sessionId, name: session.name }, 'Resuming session');

      await session.container.unpause();
      session.state = 'active';
      session.lastUsedAt = new Date();

      this.log.info({ sessionId }, 'Session resumed');
    } catch (error: any) {
      this.log.error(
        { sessionId, error: error.message },
        'Failed to resume session'
      );
      throw error;
    }
  }

  /**
   * Destroy a session (stop and remove container)
   */
  public async destroy(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      this.log.info({ sessionId, name: session.name }, 'Destroying session');

      // Stop and remove container
      await session.container.stop();
      await session.container.remove();

      // Remove from maps
      this.sessions.delete(session.id);
      this.sessionsByName.delete(session.name);

      this.log.info({ sessionId }, 'Session destroyed');
    } catch (error: any) {
      this.log.error(
        { sessionId, error: error.message },
        'Failed to destroy session'
      );
      throw error;
    }
  }

  /**
   * Extend session TTL
   */
  public async extend(sessionId: string, additionalSeconds: number): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.expiresAt) {
      // No TTL set, set one now
      session.expiresAt = new Date(Date.now() + additionalSeconds * 1000);
    } else {
      // Extend existing TTL
      session.expiresAt = new Date(
        session.expiresAt.getTime() + additionalSeconds * 1000
      );
    }

    this.log.info(
      { sessionId, expiresAt: session.expiresAt },
      'Session TTL extended'
    );
  }

  /**
   * Get session count
   */
  public getCount(): number {
    return this.sessions.size;
  }

  /**
   * Get sessions by state
   */
  public getByState(state: SessionState): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.state === state);
  }

  /**
   * Shutdown session manager
   */
  public async shutdown(): Promise<void> {
    this.log.info({ sessionCount: this.sessions.size }, 'Shutting down session manager');

    // Stop garbage collection
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
    }

    // Destroy all sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      try {
        await this.destroy(id);
      } catch (error: any) {
        this.log.error(
          { sessionId: id, error: error.message },
          'Failed to destroy session during shutdown'
        );
      }
    }

    this.log.info('Session manager shut down');
  }

  // ========== Private Methods ==========

  /**
   * Start garbage collection loop
   */
  private startGarbageCollection(intervalMs: number): void {
    this.gcInterval = setInterval(async () => {
      await this.cleanup();
    }, intervalMs);

    this.log.info({ interval: intervalMs }, 'Garbage collection started');
  }

  /**
   * Clean up expired sessions
   */
  public async cleanup(): Promise<void> {
    const now = new Date();
    const expired: string[] = [];

    // Find expired sessions
    for (const session of this.sessions.values()) {
      if (session.expiresAt && session.expiresAt <= now) {
        expired.push(session.id);
      }
    }

    if (expired.length === 0) {
      this.log.debug('No expired sessions to clean up');
      return;
    }

    this.log.info({ expiredCount: expired.length }, 'Cleaning up expired sessions');

    // Destroy expired sessions
    let cleanedCount = 0;
    for (const id of expired) {
      try {
        // Check if session still exists (might have been removed by another cleanup)
        const session = this.sessions.get(id);
        if (!session) {
          continue;
        }

        await this.destroy(id);
        cleanedCount++;
        this.log.info({ sessionId: id }, 'Expired session cleaned up');
      } catch (error: any) {
        this.log.error(
          { sessionId: id, error: error.message },
          'Failed to clean up expired session'
        );
      }
    }

    this.log.info({ cleanedCount }, 'Cleanup completed');
  }
}
