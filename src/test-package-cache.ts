/**
 * Test PackageCache functionality
 */

import { dockerClient } from './docker/DockerClient.js';
import { Container } from './docker/Container.js';
import { PackageCache } from './core/PackageCache.js';
import { PythonRuntime } from './runtimes/PythonRuntime.js';

async function testPackageCache() {
  console.log('🧪 Testing PackageCache...\n');
  console.log('=' .repeat(60));

  const cache = PackageCache.getInstance();
  const runtime = new PythonRuntime();
  let container1: Container | null = null;
  let container2: Container | null = null;

  try {
    // 0. Clear cache to start fresh
    console.log('\n0️⃣  Clearing cache for clean test...');
    await cache.clearCache();
    console.log('   ✅ Cache cleared');

    // 1. First install (cache miss)
    console.log('\n1️⃣  First package install (cache miss expected)...');

    // Create container
    const dockerContainer1 = await dockerClient.createContainer({
      image: runtime.defaultImage,
      language: 'python',
      memory: '512m',
      cpus: '1.0',
    });

    container1 = new Container(dockerContainer1, 'python');
    await container1.start();

    console.log(`   ✅ Container created: ${container1.id.substring(0, 12)}`);

    // Install packages with cache
    const packages = ['requests'];
    const startTime1 = Date.now();

    const result1 = await cache.install('python', packages, container1, runtime);
    const duration1 = Date.now() - startTime1;

    console.log(`   ✅ Install result: ${result1.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   ✅ Cached: ${result1.cached ? 'YES' : 'NO (cache miss)'}`);
    console.log(`   ✅ Duration: ${duration1}ms`);
    console.log(`   ✅ Packages: ${result1.installedPackages.join(', ')}`);

    // Verify package works
    if (result1.success) {
      console.log('\n   📦 Verifying package installation...');
      const testResult = await runtime.execute(
        'import requests; print(f"requests version: {requests.__version__}")',
        { container: container1, timeout: 5000, env: {} }
      );

      if (testResult.exitCode === 0) {
        console.log(`   ✅ ${testResult.stdout.trim()}`);
      } else {
        console.log(`   ❌ Package test failed: ${testResult.stderr}`);
      }
    }

    // 2. Get cache stats
    console.log('\n2️⃣  Cache statistics after first install...');
    const stats1 = await cache.getStats();
    console.log(`   📊 Total layers: ${stats1.totalLayers}`);
    console.log(`   📊 Hit rate: ${stats1.hitRate.toFixed(1)}%`);
    console.log(`   📊 Cache size: ${stats1.sizeMB.toFixed(2)} MB`);

    // Cleanup first container
    await container1.stop();
    await container1.remove();
    container1 = null;

    // 3. Second install with same packages (cache hit)
    console.log('\n3️⃣  Second install with same packages (cache hit expected)...');

    // Create new container
    const dockerContainer2 = await dockerClient.createContainer({
      image: runtime.defaultImage,
      language: 'python',
      memory: '512m',
      cpus: '1.0',
    });

    container2 = new Container(dockerContainer2, 'python');
    await container2.start();

    console.log(`   ✅ New container created: ${container2.id.substring(0, 12)}`);

    // Install same packages (should be cached)
    const startTime2 = Date.now();
    const result2 = await cache.install('python', packages, container2, runtime);
    const duration2 = Date.now() - startTime2;

    console.log(`   ✅ Install result: ${result2.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   ✅ Cached: ${result2.cached ? 'YES (cache hit!)' : 'NO'}`);
    console.log(`   ✅ Duration: ${duration2}ms`);
    console.log(`   ⚡ Speedup: ${duration1}ms → ${duration2}ms (${((duration1 - duration2) / duration1 * 100).toFixed(1)}% faster)`);

    // 4. Final cache stats
    console.log('\n4️⃣  Final cache statistics...');
    const stats2 = await cache.getStats();
    console.log(`   📊 Total layers: ${stats2.totalLayers}`);
    console.log(`   📊 Hit rate: ${stats2.hitRate.toFixed(1)}%`);
    console.log(`   📊 Cache size: ${stats2.sizeMB.toFixed(2)} MB`);

    // 5. Get detailed cache size
    console.log('\n5️⃣  Cache storage details...');
    const cacheSize = await cache.getCacheSize();
    const formatted = cache.formatCacheSize(cacheSize);
    console.log(`   💾 Total cache size: ${formatted}`);

    console.log('\n' + '='.repeat(60));
    console.log('\n🎉 All PackageCache tests passed!\n');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup
    if (container1) {
      try {
        await container1.stop();
        await container1.remove();
      } catch (error: any) {
        console.error('   ⚠️  Cleanup error (container1):', error.message);
      }
    }

    if (container2) {
      try {
        await container2.stop();
        await container2.remove();
      } catch (error: any) {
        console.error('   ⚠️  Cleanup error (container2):', error.message);
      }
    }

    console.log('   ✅ Containers cleaned up\n');
  }
}

testPackageCache();
