/**
 * MCP Multi-Language Sandbox Server
 *
 * Exposes sandbox functionality via Model Context Protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';

import { ContainerPool } from '../core/ContainerPool.js';
import { PackageCache } from '../core/PackageCache.js';
import { SessionManager } from '../core/SessionManager.js';
import {
  PythonRuntime,
  PythonMLRuntime,
  TypeScriptRuntime,
  JavaScriptRuntime,
  GoRuntime,
  RustRuntime,
  BashRuntime,
} from '../runtimes/index.js';
import { Container } from '../docker/Container.js';
import type { Language } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { auditLogger, validatePathForOperation, PathSecurityError } from '../security/index.js';
import { createHash } from 'crypto';

const log = createLogger({ component: 'MCPServer' });

// Language enum for Zod
const LanguageEnum = z.enum(['python', 'typescript', 'javascript', 'go', 'rust', 'bash']);

// Runtime instances
const runtimes: Record<Language, any> = {
  python: new PythonRuntime(),
  typescript: new TypeScriptRuntime(),
  javascript: new JavaScriptRuntime(),
  go: new GoRuntime(),
  rust: new RustRuntime(),
  bash: new BashRuntime(),
  ruby: null, // Not implemented yet
};

// ML Runtime (separate for data science workloads)
const pythonMLRuntime = new PythonMLRuntime();

// Initialize core services
let pool: ContainerPool;
let cache: PackageCache;
let sessions: SessionManager;

/**
 * Initialize all services
 */
async function initializeServices(): Promise<void> {
  log.info('Initializing MCP Sandbox services...');

  // Initialize Container Pool
  pool = ContainerPool.getInstance({
    minIdle: 2,
    maxActive: 20,
    warmupLanguages: ['python', 'typescript', 'javascript'],
    evictionPolicy: 'LRU',
    healthCheckInterval: 30000,
    containerMemory: '512m',
    containerCpus: '1.0',
  });
  await pool.initialize();

  // Initialize Package Cache
  cache = PackageCache.getInstance();

  // Initialize Session Manager
  sessions = SessionManager.getInstance();
  await sessions.initialize(60000); // 60s GC interval

  log.info('All services initialized');
}

/**
 * Create and configure the MCP Server
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-multilang-sandbox',
    version: '1.0.0',
  });

  // ============================================
  // Tool: sandbox_execute
  // ============================================
  server.registerTool(
    'sandbox_execute',
    {
      title: 'Execute Code',
      description: 'Execute code in an isolated sandbox. Supports Python, TypeScript, JavaScript, Go, Rust, and Bash.',
      inputSchema: {
        language: LanguageEnum.describe('Programming language'),
        code: z.string().describe('Code to execute'),
        session: z.string().optional().describe('Session name (optional, for persistent state)'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
        ml: z.boolean().optional().describe('Use ML runtime with numpy, pandas, sklearn, torch, mlx (Python only)'),
      },
      outputSchema: {
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number(),
        duration: z.number(),
      },
    },
    async ({ language, code, session: sessionName, timeout, ml }) => {
      log.info({ language, sessionName }, 'Executing code');

      // Generate code hash for audit
      const codeHash = createHash('sha256').update(code).digest('hex').substring(0, 16);

      try {
        let container: Container;
        let shouldRelease = false;

        // Use session container or acquire from pool
        if (sessionName) {
          const sess = await sessions.get(sessionName);
          if (!sess) {
            throw new Error(`Session not found: ${sessionName}`);
          }
          container = sess.container;
        } else {
          container = await pool.acquire(language as Language);
          shouldRelease = true;
        }

        // Audit: execution start
        auditLogger.logExecuteStart(
          language as Language,
          codeHash,
          sessionName,
          container.id
        );

        // Get runtime (use ML runtime for Python if ml=true)
        let runtime;
        if (ml && language === 'python') {
          runtime = pythonMLRuntime;
          log.info('Using Python ML runtime');
        } else {
          runtime = runtimes[language as Language];
        }
        if (!runtime) {
          throw new Error(`Unsupported language: ${language}`);
        }

        // Execute
        const result = await runtime.execute(code, {
          container,
          timeout: timeout || 30000,
          env: {},
        });

        // Audit: execution end
        auditLogger.logExecuteEnd(
          language as Language,
          codeHash,
          result.duration,
          result.exitCode,
          sessionName,
          container.id
        );

        // Release container if not using session
        if (shouldRelease) {
          await pool.release(container, language as Language);
        }

        const output = {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          duration: result.duration,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error: any) {
        log.error({ error: error.message }, 'Execution failed');
        // Audit: execution error
        auditLogger.log('EXECUTE_ERROR', { codeHash, error: error.message }, {
          language: language as Language,
          sessionId: sessionName,
          success: false,
          errorMessage: error.message,
        });
        throw error;
      }
    }
  );

  // ============================================
  // Tool: sandbox_session
  // ============================================
  server.registerTool(
    'sandbox_session',
    {
      title: 'Manage Sessions',
      description: 'Create, list, pause, resume, or destroy persistent sandbox sessions.',
      inputSchema: {
        action: z.enum(['create', 'list', 'get', 'pause', 'resume', 'destroy', 'extend']).describe('Action to perform'),
        name: z.string().optional().describe('Session name (required for create/get/pause/resume/destroy/extend)'),
        language: LanguageEnum.optional().describe('Language (required for create)'),
        ttl: z.number().optional().describe('Time to live in seconds (for create/extend)'),
      },
      outputSchema: {
        success: z.boolean(),
        message: z.string(),
        data: z.any().optional(),
      },
    },
    async ({ action, name, language, ttl }) => {
      log.info({ action, name, language }, 'Session action');

      try {
        let output: { success: boolean; message: string; data?: any };

        switch (action) {
          case 'create': {
            if (!name || !language) {
              throw new Error('name and language are required for create');
            }
            const session = await sessions.create(name, {
              language: language as Language,
              ttl: ttl || 3600, // Default 1 hour
            });
            output = {
              success: true,
              message: `Session "${name}" created`,
              data: {
                id: session.id,
                name: session.name,
                language: session.language,
                state: session.state,
                expiresAt: session.expiresAt?.toISOString(),
              },
            };
            break;
          }

          case 'list': {
            const list = await sessions.list();
            output = {
              success: true,
              message: `Found ${list.length} sessions`,
              data: list,
            };
            break;
          }

          case 'get': {
            if (!name) throw new Error('name is required for get');
            const session = await sessions.get(name);
            if (!session) {
              output = { success: false, message: `Session "${name}" not found` };
            } else {
              output = {
                success: true,
                message: `Session "${name}" found`,
                data: {
                  id: session.id,
                  name: session.name,
                  language: session.language,
                  state: session.state,
                  createdAt: session.createdAt.toISOString(),
                  lastUsedAt: session.lastUsedAt.toISOString(),
                  expiresAt: session.expiresAt?.toISOString(),
                },
              };
            }
            break;
          }

          case 'pause': {
            if (!name) throw new Error('name is required for pause');
            const session = await sessions.get(name);
            if (!session) throw new Error(`Session "${name}" not found`);
            await sessions.pause(session.id);
            output = { success: true, message: `Session "${name}" paused` };
            break;
          }

          case 'resume': {
            if (!name) throw new Error('name is required for resume');
            const session = await sessions.get(name);
            if (!session) throw new Error(`Session "${name}" not found`);
            await sessions.resume(session.id);
            output = { success: true, message: `Session "${name}" resumed` };
            break;
          }

          case 'destroy': {
            if (!name) throw new Error('name is required for destroy');
            const session = await sessions.get(name);
            if (!session) throw new Error(`Session "${name}" not found`);
            await sessions.destroy(session.id);
            output = { success: true, message: `Session "${name}" destroyed` };
            break;
          }

          case 'extend': {
            if (!name || !ttl) throw new Error('name and ttl are required for extend');
            const session = await sessions.get(name);
            if (!session) throw new Error(`Session "${name}" not found`);
            await sessions.extend(session.id, ttl);
            output = {
              success: true,
              message: `Session "${name}" TTL extended by ${ttl} seconds`,
            };
            break;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error: any) {
        log.error({ error: error.message }, 'Session action failed');
        throw error;
      }
    }
  );

  // ============================================
  // Tool: sandbox_install
  // ============================================
  server.registerTool(
    'sandbox_install',
    {
      title: 'Install Packages',
      description: 'Install packages in a sandbox session. Uses caching for fast repeated installs.',
      inputSchema: {
        session: z.string().describe('Session name'),
        packages: z.array(z.string()).describe('Packages to install'),
      },
      outputSchema: {
        success: z.boolean(),
        cached: z.boolean(),
        duration: z.number(),
        installedPackages: z.array(z.string()),
        errors: z.array(z.string()).optional(),
      },
    },
    async ({ session: sessionName, packages }) => {
      log.info({ sessionName, packages }, 'Installing packages');

      try {
        const session = await sessions.get(sessionName);
        if (!session) {
          throw new Error(`Session not found: ${sessionName}`);
        }

        const runtime = runtimes[session.language];
        if (!runtime) {
          throw new Error(`Unsupported language: ${session.language}`);
        }

        const result = await cache.install(
          session.language,
          packages,
          session.container,
          runtime
        );

        // Convert to plain object for MCP compatibility
        const output = JSON.parse(JSON.stringify(result));

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error: any) {
        log.error({ error: error.message }, 'Package installation failed');
        throw error;
      }
    }
  );

  // ============================================
  // Tool: sandbox_file_ops
  // ============================================
  server.registerTool(
    'sandbox_file_ops',
    {
      title: 'File Operations',
      description: 'Read, write, list, or delete files in a sandbox session.',
      inputSchema: {
        session: z.string().describe('Session name'),
        operation: z.enum(['read', 'write', 'list', 'delete']).describe('Operation to perform'),
        path: z.string().describe('File path (relative to /workspace)'),
        content: z.string().optional().describe('File content (for write operation)'),
      },
      outputSchema: {
        success: z.boolean(),
        data: z.any().optional(),
        error: z.string().optional(),
      },
    },
    async ({ session: sessionName, operation, path, content }) => {
      log.info({ sessionName, operation, path }, 'File operation');

      try {
        const session = await sessions.get(sessionName);
        if (!session) {
          throw new Error(`Session not found: ${sessionName}`);
        }

        const container = session.container;

        // Validate and sanitize path to prevent traversal attacks
        const fullPath = validatePathForOperation(path, operation);
        log.debug({ originalPath: path, sanitizedPath: fullPath }, 'Path sanitized');

        let output: { success: boolean; data?: any; error?: string };

        switch (operation) {
          case 'read': {
            const fileContent = await container.getFile(fullPath);
            output = { success: true, data: fileContent };
            break;
          }

          case 'write': {
            if (!content) throw new Error('content is required for write');
            await container.putFile(fullPath, content);
            output = { success: true, data: `File written: ${fullPath}` };
            break;
          }

          case 'list': {
            const result = await container.exec(['ls', '-la', fullPath]);
            output = { success: true, data: result.stdout };
            break;
          }

          case 'delete': {
            await container.deleteFile(fullPath);
            output = { success: true, data: `File deleted: ${fullPath}` };
            break;
          }

          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error: any) {
        log.error({ error: error.message }, 'File operation failed');
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }, null, 2) }],
          structuredContent: { success: false, error: error.message },
        };
      }
    }
  );

  // ============================================
  // Tool: sandbox_inspect
  // ============================================
  server.registerTool(
    'sandbox_inspect',
    {
      title: 'Inspect Sandbox',
      description: 'Get stats and status of the sandbox system.',
      inputSchema: {
        target: z.enum(['pool', 'cache', 'sessions', 'audit', 'all']).describe('What to inspect'),
      },
      outputSchema: {
        pool: z.any().optional(),
        cache: z.any().optional(),
        sessions: z.any().optional(),
        audit: z.any().optional(),
      },
    },
    async ({ target }) => {
      log.info({ target }, 'Inspecting sandbox');

      try {
        const output: any = {};

        if (target === 'pool' || target === 'all') {
          output.pool = pool.getStats();
        }

        if (target === 'cache' || target === 'all') {
          output.cache = await cache.getStats();
        }

        if (target === 'sessions' || target === 'all') {
          output.sessions = {
            total: sessions.getCount(),
            active: sessions.getByState('active').length,
            paused: sessions.getByState('paused').length,
            stopped: sessions.getByState('stopped').length,
          };
        }

        if (target === 'audit' || target === 'all') {
          output.audit = auditLogger.getStats();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error: any) {
        log.error({ error: error.message }, 'Inspection failed');
        throw error;
      }
    }
  );

  // ============================================
  // Tool: sandbox_security
  // ============================================
  server.registerTool(
    'sandbox_security',
    {
      title: 'Security Audit',
      description: 'View security events and audit logs.',
      inputSchema: {
        action: z.enum(['events', 'violations', 'stats']).describe('What to view'),
        count: z.number().optional().describe('Number of events to return (default: 20)'),
      },
      outputSchema: {
        events: z.array(z.any()).optional(),
        stats: z.any().optional(),
      },
    },
    async ({ action, count }) => {
      log.info({ action, count }, 'Security audit query');

      try {
        const output: any = {};
        const limit = count || 20;

        switch (action) {
          case 'events':
            output.events = auditLogger.getRecentEvents(limit);
            break;

          case 'violations':
            output.events = auditLogger.getSecurityEvents(limit);
            break;

          case 'stats':
            output.stats = auditLogger.getStats();
            break;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error: any) {
        log.error({ error: error.message }, 'Security audit query failed');
        throw error;
      }
    }
  );

  return server;
}

/**
 * Main entry point
 */
async function main() {
  try {
    log.info('Starting MCP Multi-Language Sandbox Server...');

    // Initialize services
    await initializeServices();

    // Create MCP server
    const server = createMcpServer();

    // Connect via stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);

    log.info('MCP Server running via stdio');

    // Handle shutdown
    process.on('SIGINT', async () => {
      log.info('Shutting down...');
      await sessions.shutdown();
      await pool.drain();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('Shutting down...');
      await sessions.shutdown();
      await pool.drain();
      process.exit(0);
    });
  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to start server');
    process.exit(1);
  }
}

main();
