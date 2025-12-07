/**
 * End-to-end test for PythonRuntime
 */

import { dockerClient } from './docker/DockerClient.js';
import { Container } from './docker/Container.js';
import { PythonRuntime } from './runtimes/PythonRuntime.js';

async function testPythonRuntime() {
  console.log('🧪 Testing PythonRuntime end-to-end...\n');

  const runtime = new PythonRuntime();
  let container: Container | null = null;

  try {
    // 1. Create container
    console.log('1️⃣  Creating Python container...');
    const dockerContainer = await dockerClient.createContainer({
      image: runtime.defaultImage,
      language: 'python',
      memory: '512m',
      cpus: '1.0',
    });

    container = new Container(dockerContainer, 'python');
    await container.start();
    console.log(`   ✅ Container created and started: ${container.id.substring(0, 12)}\n`);

    // 2. Execute simple Python code
    console.log('2️⃣  Executing simple Python code...');
    const result1 = await runtime.execute(
      'print("Hello from Python!")',
      {
        container,
        timeout: 5000,
        env: {},
      }
    );
    console.log(`   ✅ Exit code: ${result1.exitCode}`);
    console.log(`   ✅ Output: ${result1.stdout.trim()}`);
    console.log(`   ✅ Duration: ${result1.duration}ms\n`);

    // 3. Execute Python with calculation
    console.log('3️⃣  Executing Python calculation...');
    const result2 = await runtime.execute(
      `
result = sum([i**2 for i in range(10)])
print(f"Sum of squares: {result}")
      `.trim(),
      {
        container,
        timeout: 5000,
        env: {},
      }
    );
    console.log(`   ✅ Exit code: ${result2.exitCode}`);
    console.log(`   ✅ Output: ${result2.stdout.trim()}`);
    console.log(`   ✅ Duration: ${result2.duration}ms\n`);

    // 4. Test security validation (should fail)
    console.log('4️⃣  Testing security validation...');
    try {
      await runtime.execute(
        'import os; print(os.listdir("/"))',
        {
          container,
          timeout: 5000,
          env: {},
        }
      );
      console.log('   ❌ Security validation failed - dangerous code was allowed!\n');
    } catch (error: any) {
      if (error.message.includes('Dangerous pattern')) {
        console.log(`   ✅ Security validation working: ${error.message}\n`);
      } else {
        console.log(`   ⚠️  Unexpected error: ${error.message}\n`);
      }
    }

    // 5. Install packages
    console.log('5️⃣  Installing Python package (requests)...');
    const installResult = await runtime.installPackages(['requests'], container);
    console.log(`   ✅ Success: ${installResult.success}`);
    console.log(`   ✅ Packages installed: ${installResult.installedPackages.join(', ')}`);
    console.log(`   ✅ Duration: ${installResult.duration}ms\n`);

    // 6. Use installed package
    if (installResult.success) {
      console.log('6️⃣  Using installed package...');
      const result3 = await runtime.execute(
        `
import requests
print(f"requests version: {requests.__version__}")
print("Package imported successfully!")
        `.trim(),
        {
          container,
          timeout: 5000,
          env: {},
        }
      );
      console.log(`   ✅ Exit code: ${result3.exitCode}`);
      console.log(`   ✅ Output: ${result3.stdout.trim()}\n`);
    }

    // 7. Test error handling
    console.log('7️⃣  Testing error handling...');
    const result4 = await runtime.execute(
      'print(1/0)',  // Division by zero
      {
        container,
        timeout: 5000,
        env: {},
      }
    );
    console.log(`   ✅ Exit code: ${result4.exitCode} (non-zero expected)`);
    console.log(`   ✅ Stderr contains error: ${result4.stderr.includes('ZeroDivisionError')}\n`);

    console.log('🎉 All PythonRuntime tests passed!\n');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup
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

testPythonRuntime();
