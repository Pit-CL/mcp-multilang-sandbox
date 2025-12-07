/**
 * MCP Tools Integration Test Suite
 *
 * Tests all MCP tools: execute, session, install, file_ops, inspect, security
 */

import { ContainerPool } from './core/ContainerPool.js';
import { PackageCache } from './core/PackageCache.js';
import { SessionManager } from './core/SessionManager.js';
import {
  PythonRuntime,
  PythonMLRuntime,
  TypeScriptRuntime,
  JavaScriptRuntime,
  BashRuntime,
} from './runtimes/index.js';
import { auditLogger } from './security/index.js';
import type { Language } from './types/index.js';

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

// Helper to run a test
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({ name, passed: false, duration: Date.now() - start, error: error.message });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

// Initialize services
let pool: ContainerPool;
let cache: PackageCache;
let sessions: SessionManager;

async function initServices(): Promise<void> {
  console.log('\n📦 Initializing services...\n');

  pool = ContainerPool.getInstance({
    minIdle: 1,
    maxActive: 10,
    warmupLanguages: ['python', 'bash'],
    evictionPolicy: 'LRU',
    healthCheckInterval: 60000,
  });
  await pool.initialize();

  cache = PackageCache.getInstance();
  sessions = SessionManager.getInstance();
  await sessions.initialize(60000);

  console.log('✅ Services initialized\n');
}

// ============================================
// Test: sandbox_execute equivalent
// ============================================
async function testExecutePython(): Promise<void> {
  const runtime = new PythonRuntime();
  const container = await pool.acquire('python');

  const result = await runtime.execute('print("Hello from Python!")', {
    container,
    timeout: 10000,
    env: {},
  });

  await pool.release(container, 'python');

  if (result.exitCode !== 0) throw new Error(`Exit code: ${result.exitCode}`);
  if (!result.stdout.includes('Hello from Python')) throw new Error('Output mismatch');
}

async function testExecuteTypeScript(): Promise<void> {
  const runtime = new TypeScriptRuntime();
  const container = await pool.acquire('typescript');

  const result = await runtime.execute(
    'const x: number = 42; console.log(`Answer: ${x}`);',
    { container, timeout: 10000, env: {} }
  );

  await pool.release(container, 'typescript');

  if (result.exitCode !== 0) throw new Error(`Exit code: ${result.exitCode}`);
  if (!result.stdout.includes('42')) throw new Error('Output mismatch');
}

async function testExecuteJavaScript(): Promise<void> {
  const runtime = new JavaScriptRuntime();
  const container = await pool.acquire('javascript');

  const result = await runtime.execute(
    'console.log(JSON.stringify({ status: "ok", nums: [1,2,3] }));',
    { container, timeout: 10000, env: {} }
  );

  await pool.release(container, 'javascript');

  if (result.exitCode !== 0) throw new Error(`Exit code: ${result.exitCode}`);
  if (!result.stdout.includes('status')) throw new Error('Output mismatch');
}

async function testExecuteBash(): Promise<void> {
  const runtime = new BashRuntime();
  const container = await pool.acquire('bash');

  const result = await runtime.execute('echo "Bash test: $(whoami)"', {
    container,
    timeout: 10000,
    env: {},
  });

  await pool.release(container, 'bash');

  if (result.exitCode !== 0) throw new Error(`Exit code: ${result.exitCode}`);
  if (!result.stdout.includes('Bash test')) throw new Error('Output mismatch');
}

async function testExecutePythonML(): Promise<void> {
  const runtime = new PythonMLRuntime();
  const container = await pool.acquire('python');

  // Test that ML runtime can execute standard Python
  const result = await runtime.execute('print("ML Runtime OK")', {
    container,
    timeout: 10000,
    env: {},
  });

  await pool.release(container, 'python');

  if (result.exitCode !== 0) throw new Error(`Exit code: ${result.exitCode}`);
  if (!result.stdout.includes('ML Runtime OK')) throw new Error('Output mismatch');
}

// ============================================
// Test: sandbox_session equivalent
// ============================================
async function testSessionCreate(): Promise<void> {
  const session = await sessions.create('test-session-1', {
    language: 'python' as Language,
    ttl: 300,
  });

  if (!session.id) throw new Error('Session ID missing');
  if (session.name !== 'test-session-1') throw new Error('Session name mismatch');
  if (session.state !== 'active') throw new Error('Session not active');
}

async function testSessionGet(): Promise<void> {
  const session = await sessions.get('test-session-1');
  if (!session) throw new Error('Session not found');
  if (session.language !== 'python') throw new Error('Language mismatch');
}

async function testSessionList(): Promise<void> {
  const list = await sessions.list();
  if (list.length === 0) throw new Error('No sessions found');

  const found = list.some(s => s.name === 'test-session-1');
  if (!found) throw new Error('Test session not in list');
}

async function testSessionPauseResume(): Promise<void> {
  const session = await sessions.get('test-session-1');
  if (!session) throw new Error('Session not found');

  await sessions.pause(session.id);
  const paused = await sessions.get('test-session-1');
  if (paused?.state !== 'paused') throw new Error('Session not paused');

  await sessions.resume(session.id);
  const resumed = await sessions.get('test-session-1');
  if (resumed?.state !== 'active') throw new Error('Session not resumed');
}

async function testSessionExtend(): Promise<void> {
  const session = await sessions.get('test-session-1');
  if (!session) throw new Error('Session not found');

  const originalExpiry = session.expiresAt?.getTime() || 0;
  await sessions.extend(session.id, 600);

  const extended = await sessions.get('test-session-1');
  const newExpiry = extended?.expiresAt?.getTime() || 0;

  if (newExpiry <= originalExpiry) throw new Error('TTL not extended');
}

async function testSessionDestroy(): Promise<void> {
  const session = await sessions.get('test-session-1');
  if (!session) throw new Error('Session not found');

  await sessions.destroy(session.id);

  const destroyed = await sessions.get('test-session-1');
  if (destroyed) throw new Error('Session still exists');
}

// ============================================
// Test: sandbox_inspect equivalent
// ============================================
async function testInspectPool(): Promise<void> {
  const stats = pool.getStats();

  if (typeof stats.total !== 'number') throw new Error('Missing total');
  if (typeof stats.available !== 'number') throw new Error('Missing available');
  if (typeof stats.inUse !== 'number') throw new Error('Missing inUse');
  if (!stats.byLanguage) throw new Error('Missing byLanguage');
}

async function testInspectCache(): Promise<void> {
  const stats = await cache.getStats();

  if (typeof stats.totalLayers !== 'number') throw new Error('Missing totalLayers');
  if (typeof stats.hitRate !== 'number') throw new Error('Missing hitRate');
}

async function testInspectSessions(): Promise<void> {
  const count = sessions.getCount();
  if (typeof count !== 'number') throw new Error('Invalid count');

  const active = sessions.getByState('active');
  if (!Array.isArray(active)) throw new Error('getByState failed');
}

// ============================================
// Test: sandbox_security equivalent
// ============================================
async function testAuditLog(): Promise<void> {
  // Log a test event
  auditLogger.log('EXECUTE_START', { test: true }, {
    language: 'python' as Language,
    sessionId: 'test-session',
  });

  const stats = auditLogger.getStats();
  if (stats.totalEvents === 0) throw new Error('No events logged');
}

async function testAuditGetEvents(): Promise<void> {
  const events = auditLogger.getRecentEvents(10);
  if (!Array.isArray(events)) throw new Error('Events not array');
}

async function testAuditGetStats(): Promise<void> {
  const stats = auditLogger.getStats();

  if (typeof stats.totalEvents !== 'number') throw new Error('Missing totalEvents');
  if (!stats.eventsByType) throw new Error('Missing eventsByType');
  if (!stats.eventsBySeverity) throw new Error('Missing eventsBySeverity');
}

// ============================================
// Test: Security validation
// ============================================
async function testSecurityBlockDangerousCode(): Promise<void> {
  const runtime = new PythonRuntime();
  const container = await pool.acquire('python');

  try {
    // This should be blocked by pattern validation
    await runtime.execute('import os; os.system("ls")', {
      container,
      timeout: 5000,
      env: {},
    });
    await pool.release(container, 'python');
    throw new Error('Dangerous code was not blocked');
  } catch (error: any) {
    await pool.release(container, 'python');
    if (!error.message.includes('Dangerous pattern')) {
      throw new Error(`Wrong error: ${error.message}`);
    }
  }
}

async function testSecurityBlockSubprocess(): Promise<void> {
  const runtime = new PythonRuntime();
  const container = await pool.acquire('python');

  try {
    await runtime.execute('import subprocess', {
      container,
      timeout: 5000,
      env: {},
    });
    await pool.release(container, 'python');
    throw new Error('subprocess import was not blocked');
  } catch (error: any) {
    await pool.release(container, 'python');
    if (!error.message.includes('Dangerous pattern')) {
      throw new Error(`Wrong error: ${error.message}`);
    }
  }
}

// ============================================
// Main test runner
// ============================================
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     MCP Multi-Language Sandbox PRO - Test Suite          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    await initServices();

    // Execute tests
    console.log('📝 Testing Code Execution...');
    await runTest('Execute Python', testExecutePython);
    await runTest('Execute TypeScript', testExecuteTypeScript);
    await runTest('Execute JavaScript', testExecuteJavaScript);
    await runTest('Execute Bash', testExecuteBash);
    await runTest('Execute Python ML Runtime', testExecutePythonML);

    console.log('\n📝 Testing Sessions...');
    await runTest('Session Create', testSessionCreate);
    await runTest('Session Get', testSessionGet);
    await runTest('Session List', testSessionList);
    await runTest('Session Pause/Resume', testSessionPauseResume);
    await runTest('Session Extend TTL', testSessionExtend);
    await runTest('Session Destroy', testSessionDestroy);

    console.log('\n📝 Testing Inspect...');
    await runTest('Inspect Pool', testInspectPool);
    await runTest('Inspect Cache', testInspectCache);
    await runTest('Inspect Sessions', testInspectSessions);

    console.log('\n📝 Testing Security...');
    await runTest('Audit Log', testAuditLog);
    await runTest('Audit Get Events', testAuditGetEvents);
    await runTest('Audit Get Stats', testAuditGetStats);
    await runTest('Block Dangerous Code (os)', testSecurityBlockDangerousCode);
    await runTest('Block Dangerous Code (subprocess)', testSecurityBlockSubprocess);

    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const totalTime = results.reduce((acc, r) => acc + r.duration, 0);

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                      TEST SUMMARY                        ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`\n  Total:  ${results.length}`);
    console.log(`  Passed: ${passed} ✅`);
    console.log(`  Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
    console.log(`  Time:   ${totalTime}ms`);

    if (failed > 0) {
      console.log('\n  Failed tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`    - ${r.name}: ${r.error}`);
      });
    }

    console.log('\n');

    // Cleanup
    await sessions.shutdown();
    await pool.drain();

    process.exit(failed > 0 ? 1 : 0);
  } catch (error: any) {
    console.error('Test suite failed:', error.message);
    process.exit(1);
  }
}

main();
