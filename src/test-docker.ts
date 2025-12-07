/**
 * Simple test script for DockerClient and Container
 */

import { dockerClient } from './docker/DockerClient.js';
import { Container } from './docker/Container.js';

async function testDocker() {
  console.log('🧪 Testing Docker connection...\n');

  try {
    // 1. Ping Docker
    console.log('1️⃣  Pinging Docker...');
    const isPingOk = await dockerClient.ping();
    console.log(`   ✅ Docker is ${isPingOk ? 'RUNNING' : 'NOT RUNNING'}\n`);

    if (!isPingOk) {
      throw new Error('Docker is not running');
    }

    // 2. Get Docker info
    console.log('2️⃣  Getting Docker info...');
    const info = await dockerClient.getInfo();
    console.log(`   ✅ Docker version: ${info.ServerVersion}`);
    console.log(`   ✅ Operating system: ${info.OperatingSystem}`);
    console.log(`   ✅ Architecture: ${info.Architecture}\n`);

    // 3. Pull Python image
    console.log('3️⃣  Pulling python:3.11-slim image (this may take a minute)...');
    await dockerClient.pullImage('python:3.11-slim', (progress) => {
      if (progress.status === 'Downloading' || progress.status === 'Extracting') {
        process.stdout.write(`   📦 ${progress.status}...\r`);
      }
    });
    console.log('   ✅ Image pulled successfully\n');

    // 4. Create container
    console.log('4️⃣  Creating container...');
    const dockerContainer = await dockerClient.createContainer({
      image: 'python:3.11-slim',
      language: 'python',
      memory: '256m',
      cpus: '0.5',
    });

    const container = new Container(dockerContainer, 'python');
    console.log(`   ✅ Container created: ${container.id.substring(0, 12)}\n`);

    // 5. Start container
    console.log('5️⃣  Starting container...');
    await container.start();
    console.log('   ✅ Container started\n');

    // 6. Execute simple command
    console.log('6️⃣  Executing Python code...');
    const result = await container.exec(['python', '-c', 'print("Hello from MCP Sandbox!")']);
    console.log(`   ✅ Exit code: ${result.exitCode}`);
    console.log(`   ✅ Output: ${result.stdout.trim()}`);
    console.log(`   ✅ Duration: ${result.duration}ms\n`);

    // 7. Test file operations
    console.log('7️⃣  Testing file operations...');
    await container.putFile('/tmp/test.txt', 'Hello World!');
    const fileContent = await container.getFile('/tmp/test.txt');
    console.log(`   ✅ File written and read: ${fileContent.toString().trim()}\n`);

    // 8. Get container stats
    console.log('8️⃣  Getting container stats...');
    const stats = await container.stats();
    console.log(`   ✅ Memory usage: ${stats.memoryPeakMB.toFixed(2)} MB`);
    console.log(`   ✅ CPU time: ${stats.cpuTimeMs.toFixed(2)} ms\n`);

    // 9. Stop container
    console.log('9️⃣  Stopping container...');
    await container.stop();
    console.log('   ✅ Container stopped\n');

    // 10. Remove container
    console.log('🔟 Removing container...');
    await container.remove();
    console.log('   ✅ Container removed\n');

    console.log('🎉 All tests passed!\n');
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testDocker();
