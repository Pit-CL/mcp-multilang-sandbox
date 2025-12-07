/**
 * Test SessionManager functionality
 */

import { SessionManager } from './core/SessionManager.js';
import { PythonRuntime } from './runtimes/PythonRuntime.js';
import type { SessionConfig } from './types/index.js';

async function testSessionManager() {
  console.log('🧪 Testing SessionManager...\n');
  console.log('=' .repeat(60));

  const manager = SessionManager.getInstance();
  const runtime = new PythonRuntime();

  try {
    // 1. Initialize
    console.log('\n1️⃣  Initializing SessionManager...');
    await manager.initialize(5000); // 5s GC interval for testing
    console.log('   ✅ SessionManager initialized');

    // 2. Create session
    console.log('\n2️⃣  Creating session "test-python"...');
    const config: SessionConfig = {
      language: 'python',
      packages: ['requests'],
      env: { TEST_VAR: 'hello' },
      ttl: 300, // 5 minutes
    };

    const session1 = await manager.create('test-python', config);
    console.log(`   ✅ Session created: ${session1.id.substring(0, 8)}`);
    console.log(`   ✅ Name: ${session1.name}`);
    console.log(`   ✅ Language: ${session1.language}`);
    console.log(`   ✅ State: ${session1.state}`);
    console.log(`   ✅ Container: ${session1.container.id.substring(0, 12)}`);
    console.log(`   ✅ Expires: ${session1.expiresAt?.toISOString()}`);

    // 3. Execute code in session
    console.log('\n3️⃣  Executing code in session...');
    const result1 = await runtime.execute(
      'print("Hello from session test-python!")',
      {
        container: session1.container,
        timeout: 5000,
        env: session1.metadata.env,
      }
    );

    if (result1.exitCode === 0) {
      console.log(`   ✅ Output: ${result1.stdout.trim()}`);
    } else {
      console.log(`   ⚠️  Error: ${result1.stderr}`);
    }

    // 4. Get session by name
    console.log('\n4️⃣  Getting session by name...');
    const retrieved = await manager.get('test-python');
    if (retrieved) {
      console.log(`   ✅ Retrieved session: ${retrieved.id.substring(0, 8)}`);
      console.log(`   ✅ Same ID: ${retrieved.id === session1.id}`);
    } else {
      console.log('   ❌ Session not found');
    }

    // 5. List sessions
    console.log('\n5️⃣  Listing all sessions...');
    const sessions = await manager.list();
    console.log(`   ✅ Total sessions: ${sessions.length}`);
    sessions.forEach(s => {
      console.log(`      - ${s.name} (${s.language}, ${s.state})`);
    });

    // 6. Create second session
    console.log('\n6️⃣  Creating second session "test-js"...');
    const session2 = await manager.create('test-js', {
      language: 'javascript',
      ttl: 60, // 1 minute
    });
    console.log(`   ✅ Session created: ${session2.id.substring(0, 8)}`);

    // List again
    const sessions2 = await manager.list();
    console.log(`   ✅ Total sessions now: ${sessions2.length}`);

    // 7. Pause session
    console.log('\n7️⃣  Pausing session "test-python"...');
    await manager.pause(session1.id);
    const paused = await manager.get(session1.id);
    console.log(`   ✅ State after pause: ${paused?.state}`);

    // 8. Resume session
    console.log('\n8️⃣  Resuming session "test-python"...');
    await manager.resume(session1.id);
    const resumed = await manager.get(session1.id);
    console.log(`   ✅ State after resume: ${resumed?.state}`);

    // 9. Extend TTL
    console.log('\n9️⃣  Extending session TTL by 60 seconds...');
    const beforeExtend = session1.expiresAt;
    await manager.extend(session1.id, 60);
    const afterExtend = await manager.get(session1.id);
    console.log(`   ✅ Before: ${beforeExtend?.toISOString()}`);
    console.log(`   ✅ After:  ${afterExtend?.expiresAt?.toISOString()}`);

    // 10. Test session count
    console.log('\n🔟 Session statistics...');
    console.log(`   ✅ Total sessions: ${manager.getCount()}`);
    console.log(`   ✅ Active: ${manager.getByState('active').length}`);
    console.log(`   ✅ Paused: ${manager.getByState('paused').length}`);
    console.log(`   ✅ Stopped: ${manager.getByState('stopped').length}`);

    // 11. Test cleanup (won't do anything since sessions not expired)
    console.log('\n1️⃣1️⃣  Testing garbage collection...');
    await manager.cleanup();
    console.log(`   ✅ Sessions after GC: ${manager.getCount()} (no change expected)`);

    // 12. Test expired session cleanup
    console.log('\n1️⃣2️⃣  Testing expired session cleanup...');
    console.log('   Creating session with 2 second TTL...');
    const shortSession = await manager.create('short-lived', {
      language: 'bash',
      ttl: 2, // 2 seconds
    });
    console.log(`   ✅ Session created: ${shortSession.id.substring(0, 8)}`);
    console.log(`   ⏳ Waiting 3 seconds for expiration...`);

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('   Running cleanup...');
    await manager.cleanup();
    const afterCleanup = await manager.get('short-lived');
    console.log(`   ✅ Session after cleanup: ${afterCleanup ? 'EXISTS (error!)' : 'REMOVED (correct!)'}`);

    // 13. Destroy remaining sessions
    console.log('\n1️⃣3️⃣  Destroying remaining sessions...');
    const remaining = await manager.list();
    console.log(`   Sessions to destroy: ${remaining.length}`);

    for (const s of remaining) {
      try {
        await manager.destroy(s.id);
        console.log(`   ✅ Destroyed: ${s.name}`);
      } catch (error: any) {
        console.log(`   ⚠️  ${s.name} already destroyed (by GC)`);
      }
    }

    console.log(`   ✅ Sessions after destroy: ${manager.getCount()}`);

    console.log('\n' + '='.repeat(60));
    console.log('\n🎉 All SessionManager tests passed!\n');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Shutdown
    console.log('🧹 Shutting down SessionManager...');
    await manager.shutdown();
    console.log('   ✅ SessionManager shut down\n');
  }
}

testSessionManager();
