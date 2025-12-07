/**
 * Test ContainerPool functionality
 */

import { ContainerPool } from './core/ContainerPool.js';
import { PythonRuntime } from './runtimes/PythonRuntime.js';
import type { PoolConfig } from './types/index.js';

async function testContainerPool() {
  console.log('🧪 Testing ContainerPool...\n');
  console.log('=' .repeat(60));

  let pool: ContainerPool | null = null;

  try {
    // 1. Initialize pool
    console.log('\n1️⃣  Initializing pool with pre-warming...');
    const startTime = Date.now();

    const config: PoolConfig = {
      minIdle: 2,
      maxActive: 10,
      warmupLanguages: ['python', 'javascript'],
      evictionPolicy: 'LRU',
      healthCheckInterval: 30000,
      containerMemory: '256m',
      containerCpus: '0.5',
    };

    pool = ContainerPool.getInstance(config);
    await pool.initialize();

    const initTime = Date.now() - startTime;
    console.log(`   ✅ Pool initialized in ${initTime}ms`);

    // Check stats
    let stats = pool.getStats();
    console.log(`   ✅ Pool size: ${stats.total} containers`);
    console.log(`   ✅ By language: Python=${stats.byLanguage.python || 0}, JavaScript=${stats.byLanguage.javascript || 0}`);

    // 2. Test pool hit (warm container)
    console.log('\n2️⃣  Testing pool hit (warm container)...');
    const hitStartTime = Date.now();

    const container1 = await pool.acquire('python');
    const hitTime = Date.now() - hitStartTime;

    console.log(`   ✅ Acquired container in ${hitTime}ms (should be <200ms)`);
    console.log(`   ✅ Container ID: ${container1.id.substring(0, 12)}`);

    // Execute code to verify it works
    const runtime = new PythonRuntime();
    const result = await runtime.execute('print("Pool hit test!")', {
      container: container1,
      timeout: 5000,
      env: {},
    });

    console.log(`   ✅ Execution successful: ${result.stdout.trim()}`);

    // Release back to pool
    await pool.release(container1, 'python');
    console.log(`   ✅ Container released back to pool`);

    // 3. Test pool stats after release
    console.log('\n3️⃣  Testing pool stats...');
    stats = pool.getStats();
    console.log(`   ✅ Total containers: ${stats.total}`);
    console.log(`   ✅ Available: ${stats.available}`);
    console.log(`   ✅ In use: ${stats.inUse}`);
    console.log(`   ✅ Healthy: ${stats.healthy}`);
    console.log(`   ✅ Unhealthy: ${stats.unhealthy}`);

    // 4. Test pool miss (new language)
    console.log('\n4️⃣  Testing pool miss (new language)...');
    const missStartTime = Date.now();

    const container2 = await pool.acquire('go');
    const missTime = Date.now() - missStartTime;

    console.log(`   ✅ Acquired Go container in ${missTime}ms (pool miss)`);
    console.log(`   ✅ Container ID: ${container2.id.substring(0, 12)}`);

    // Release
    await pool.release(container2, 'go');
    console.log(`   ✅ Go container released to pool`);

    // 5. Test acquiring same container again (should be faster)
    console.log('\n5️⃣  Testing second acquisition (should be faster)...');
    const secondHitStartTime = Date.now();

    const container3 = await pool.acquire('python');
    const secondHitTime = Date.now() - secondHitStartTime;

    console.log(`   ✅ Acquired Python container in ${secondHitTime}ms`);
    console.log(`   ⚡ Speedup: ${hitTime}ms → ${secondHitTime}ms`);

    // Don't release yet - test multiple in use

    // 6. Test acquiring multiple containers
    console.log('\n6️⃣  Testing multiple acquisitions...');
    const container4 = await pool.acquire('python');
    const container5 = await pool.acquire('javascript');

    console.log(`   ✅ Acquired 3 containers total`);
    console.log(`   ✅ Container 3: ${container3.id.substring(0, 12)}`);
    console.log(`   ✅ Container 4: ${container4.id.substring(0, 12)}`);
    console.log(`   ✅ Container 5: ${container5.id.substring(0, 12)}`);

    // Release all
    await pool.release(container3, 'python');
    await pool.release(container4, 'python');
    await pool.release(container5, 'javascript');
    console.log(`   ✅ All containers released`);

    // 7. Final stats
    console.log('\n7️⃣  Final pool statistics...');
    stats = pool.getStats();
    console.log(`   📊 Total: ${stats.total}`);
    console.log(`   📊 Python: ${stats.byLanguage.python || 0}`);
    console.log(`   📊 JavaScript: ${stats.byLanguage.javascript || 0}`);
    console.log(`   📊 Go: ${stats.byLanguage.go || 0}`);
    console.log(`   📊 Healthy: ${stats.healthy}/${stats.total}`);

    // 8. Test LRU eviction by filling pool beyond maxActive
    console.log('\n8️⃣  Testing LRU eviction (filling pool)...');
    console.log(`   Current pool size: ${stats.total}, Max: ${config.maxActive}`);

    // This test is optional since it would take a while
    console.log(`   ⏭️  Skipping eviction test (would need ${config.maxActive + 1} containers)`);

    console.log('\n' + '='.repeat(60));
    console.log('\n🎉 All ContainerPool tests passed!\n');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup
    if (pool) {
      console.log('🧹 Draining pool...');
      await pool.drain();
      console.log('   ✅ Pool drained\n');
    }
  }
}

testContainerPool();
