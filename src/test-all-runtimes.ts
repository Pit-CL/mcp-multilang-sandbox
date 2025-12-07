/**
 * Comprehensive test for all runtime managers
 */

import { dockerClient } from './docker/DockerClient.js';
import { Container } from './docker/Container.js';
import {
  PythonRuntime,
  TypeScriptRuntime,
  JavaScriptRuntime,
  GoRuntime,
  RustRuntime,
  BashRuntime,
} from './runtimes/index.js';

interface TestResult {
  language: string;
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
}

async function testRuntime(
  runtime: any,
  code: string,
  languageName: string
): Promise<TestResult> {
  const startTime = Date.now();
  let container: Container | null = null;

  try {
    console.log(`\n🧪 Testing ${languageName}...`);

    // Create container
    const dockerContainer = await dockerClient.createContainer({
      image: runtime.defaultImage,
      language: runtime.language,
      memory: '512m',
      cpus: '1.0',
    });

    container = new Container(dockerContainer, runtime.language);
    await container.start();

    // Execute code
    const result = await runtime.execute(code, {
      container,
      timeout: 10000,
      env: {},
    });

    const duration = Date.now() - startTime;

    if (result.exitCode === 0) {
      console.log(`   ✅ Success! Output: ${result.stdout.trim()}`);
      console.log(`   ⏱️  Duration: ${duration}ms`);

      return {
        language: languageName,
        success: true,
        duration,
        output: result.stdout.trim(),
      };
    } else {
      console.log(`   ❌ Failed with exit code ${result.exitCode}`);
      console.log(`   Error: ${result.stderr}`);

      return {
        language: languageName,
        success: false,
        duration,
        error: result.stderr,
      };
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.log(`   ❌ Exception: ${error.message}`);

    return {
      language: languageName,
      success: false,
      duration,
      error: error.message,
    };
  } finally {
    // Cleanup
    if (container) {
      try {
        await container.stop();
        await container.remove();
      } catch (error: any) {
        console.error(`   ⚠️  Cleanup error: ${error.message}`);
      }
    }
  }
}

async function runAllTests() {
  console.log('🚀 MCP Multi-Language Sandbox - Runtime Tests\n');
  console.log('=' .repeat(60));

  const results: TestResult[] = [];

  // Test 1: Python
  results.push(
    await testRuntime(
      new PythonRuntime(),
      'print("Hello from Python!")',
      'Python'
    )
  );

  // Test 2: TypeScript
  results.push(
    await testRuntime(
      new TypeScriptRuntime(),
      'console.log("Hello from TypeScript!");',
      'TypeScript'
    )
  );

  // Test 3: JavaScript
  results.push(
    await testRuntime(
      new JavaScriptRuntime(),
      'console.log("Hello from JavaScript!");',
      'JavaScript'
    )
  );

  // Test 4: Go
  results.push(
    await testRuntime(
      new GoRuntime(),
      'fmt.Println("Hello from Go!")',
      'Go'
    )
  );

  // Test 5: Rust
  results.push(
    await testRuntime(
      new RustRuntime(),
      'println!("Hello from Rust!");',
      'Rust'
    )
  );

  // Test 6: Bash
  results.push(
    await testRuntime(
      new BashRuntime(),
      'echo "Hello from Bash!"',
      'Bash'
    )
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary:\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    const duration = `${result.duration}ms`;
    console.log(`   ${status} ${result.language.padEnd(15)} ${duration.padStart(8)}`);
  });

  console.log('\n' + '-'.repeat(60));
  console.log(`   Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) {
    console.log('❌ Some tests failed!\n');
    console.log('Failed tests:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`\n   ${r.language}:`);
        console.log(`   ${r.error}`);
      });
    process.exit(1);
  } else {
    console.log('🎉 All runtime tests passed!\n');
    console.log('✨ MCP Multi-Language Sandbox is ready!\n');
    process.exit(0);
  }
}

// Check Docker first
async function main() {
  try {
    const dockerOk = await dockerClient.ping();
    if (!dockerOk) {
      console.error('❌ Docker is not running. Please start Docker Desktop.');
      process.exit(1);
    }

    await runAllTests();
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
