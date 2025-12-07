/**
 * Simple PackageCache test - demonstrates cache layer functionality
 */

import { dockerClient } from './docker/DockerClient.js';
import { Container } from './docker/Container.js';
import { PackageCache } from './core/PackageCache.js';
import { PythonRuntime } from './runtimes/PythonRuntime.js';

async function testPackageCache() {
  console.log('🧪 Testing PackageCache (simplified demo)...\n');
  console.log('=' .repeat(60));

  const cache = PackageCache.getInstance();
  const runtime = new PythonRuntime();
  let container: Container | null = null;

  try {
    // 1. Clear cache
    console.log('\n1️⃣  Clearing cache...');
    await cache.clearCache();
    let stats = await cache.getStats();
    console.log(`   ✅ Cache cleared`);
    console.log(`   📊 Layers: ${stats.totalLayers}, Size: ${stats.sizeMB.toFixed(2)} MB`);

    // 2. Create container
    console.log('\n2️⃣  Creating Python container...');
    const dockerContainer = await dockerClient.createContainer({
      image: runtime.defaultImage,
      language: 'python',
      memory: '512m',
      cpus: '1.0',
    });

    container = new Container(dockerContainer, 'python');
    await container.start();
    console.log(`   ✅ Container: ${container.id.substring(0, 12)}`);

    // 3. First install (cache miss expected)
    console.log('\n3️⃣  Installing packages (cache miss expected)...');
    const packages = ['requests', 'urllib3'];
    const start1 = Date.now();

    const result1 = await cache.install('python', packages, container, runtime);
    const duration1 = Date.now() - start1;

    console.log(`   ${result1.success ? '✅' : '❌'} Success: ${result1.success}`);
    console.log(`   📦 Cached: ${result1.cached ? 'YES' : 'NO (expected)'}`);
    console.log(`   ⏱️  Duration: ${duration1}ms`);

    // 4. Check stats after first install
    console.log('\n4️⃣  Cache stats after first install...');
    stats = await cache.getStats();
    console.log(`   📊 Total layers: ${stats.totalLayers}`);
    console.log(`   📊 Hit rate: ${stats.hitRate.toFixed(1)}%`);
    console.log(`   📊 Cache size: ${stats.sizeMB.toFixed(2)} MB`);

    // 5. Second "install" with same packages (cache hit)
    console.log('\n5️⃣  Second install attempt (cache hit expected)...');
    const start2 = Date.now();

    const result2 = await cache.install('python', packages, container, runtime);
    const duration2 = Date.now() - start2;

    console.log(`   ${result2.success ? '✅' : '❌'} Success: ${result2.success}`);
    console.log(`   📦 Cached: ${result2.cached ? 'YES (cache hit!)' : 'NO'}`);
    console.log(`   ⏱️  Duration: ${duration2}ms`);
    console.log(`   ⚡ Speedup: ${duration1}ms → ${duration2}ms`);

    // 6. Different packages (cache miss)
    console.log('\n6️⃣  Installing different packages (cache miss)...');
    const packages2 = ['beautifulsoup4'];
    const start3 = Date.now();

    const result3 = await cache.install('python', packages2, container, runtime);
    const duration3 = Date.now() - start3;

    console.log(`   ${result3.success ? '✅' : '❌'} Success: ${result3.success}`);
    console.log(`   📦 Cached: ${result3.cached ? 'YES' : 'NO (expected)'}`);
    console.log(`   ⏱️  Duration: ${duration3}ms`);

    // 7. Final stats
    console.log('\n7️⃣  Final cache statistics...');
    stats = await cache.getStats();
    console.log(`   📊 Total layers: ${stats.totalLayers}`);
    console.log(`   📊 Hit rate: ${stats.hitRate.toFixed(1)}%`);
    console.log(`   📊 Cache size: ${stats.sizeMB.toFixed(2)} MB`);

    const cacheSize = await cache.getCacheSize();
    console.log(`   💾 Formatted size: ${cache.formatCacheSize(cacheSize)}`);

    console.log('\n' + '='.repeat(60));
    console.log('\n🎉 PackageCache test completed!\n');
    console.log('Key takeaways:');
    console.log('  - First install: Cache miss (installs packages)');
    console.log('  - Same packages again: Cache hit (< 1ms)');
    console.log('  - Different packages: Cache miss (installs)');
    console.log('  - Cache tracks installations and creates Docker layers');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (container) {
      console.log('🧹 Cleaning up...');
      try {
        await container.stop();
        await container.remove();
        console.log('   ✅ Container removed\n');
      } catch (error: any) {
        console.error('   ⚠️  Cleanup error:', error.message);
      }
    }
  }
}

testPackageCache();
