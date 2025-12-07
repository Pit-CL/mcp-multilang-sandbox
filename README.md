# MCP Multi-Language Sandbox PRO

> Execute code securely in 6 programming languages with Docker isolation, ML support, and enterprise-grade security.

## Features

- **Multi-Language Support**: Python, TypeScript, JavaScript, Go, Rust, Bash
- **Fast Execution**: Container pooling for 0ms cold start (pool hits)
- **Package Caching**: SHA256-based layer caching
- **ML Runtime**: numpy, pandas, sklearn, torch, mlx pre-installed
- **Secure Isolation**: Seccomp profiles, capability dropping, audit logging
- **Persistent Sessions**: Named sessions with TTL and auto-cleanup
- **100% Free**: No cloud dependencies, runs locally

## Quick Start

```bash
# Install
cd ~/.claude/mcp-servers/multilang-pro
npm install && npm run build

# Add to Claude (already configured)
claude mcp add multilang-sandbox node ~/.claude/mcp-servers/multilang-pro/dist/mcp/server.js
```

## MCP Tools

### sandbox_execute
Execute code in an isolated sandbox.

```typescript
// Basic execution
sandbox_execute({
  language: 'python',
  code: 'print("Hello!")'
})

// With ML runtime (numpy, pandas, sklearn, torch)
sandbox_execute({
  language: 'python',
  code: 'import numpy as np; print(np.array([1,2,3]))',
  ml: true
})

// In a session
sandbox_execute({
  language: 'python',
  code: 'print(x)',  // Uses session state
  session: 'my-session'
})
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| language | string | Yes | python, typescript, javascript, go, rust, bash |
| code | string | Yes | Code to execute |
| session | string | No | Session name for persistent state |
| timeout | number | No | Timeout in ms (default: 30000) |
| ml | boolean | No | Use ML runtime (Python only) |

### sandbox_session
Manage persistent sessions.

```typescript
// Create session
sandbox_session({ action: 'create', name: 'ml-project', language: 'python', ttl: 3600 })

// List sessions
sandbox_session({ action: 'list' })

// Pause/Resume
sandbox_session({ action: 'pause', name: 'ml-project' })
sandbox_session({ action: 'resume', name: 'ml-project' })

// Extend TTL
sandbox_session({ action: 'extend', name: 'ml-project', ttl: 7200 })

// Destroy
sandbox_session({ action: 'destroy', name: 'ml-project' })
```

### sandbox_install
Install packages with caching.

```typescript
sandbox_install({
  session: 'ml-project',
  packages: ['pandas', 'matplotlib', 'scikit-learn']
})
```

### sandbox_file_ops
File operations in sessions.

```typescript
// Write file
sandbox_file_ops({ session: 'ml-project', operation: 'write', path: 'data.csv', content: 'a,b,c\n1,2,3' })

// Read file
sandbox_file_ops({ session: 'ml-project', operation: 'read', path: 'data.csv' })

// List files
sandbox_file_ops({ session: 'ml-project', operation: 'list', path: '.' })

// Delete file
sandbox_file_ops({ session: 'ml-project', operation: 'delete', path: 'data.csv' })
```

### sandbox_inspect
View system stats.

```typescript
// All stats
sandbox_inspect({ target: 'all' })

// Specific: pool, cache, sessions, audit
sandbox_inspect({ target: 'pool' })
```

### sandbox_security
Security audit and monitoring.

```typescript
// Recent events
sandbox_security({ action: 'events', count: 50 })

// Security violations
sandbox_security({ action: 'violations' })

// Stats
sandbox_security({ action: 'stats' })
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP CLIENT (Claude)                   │
└───────────────────────────┬─────────────────────────────┘
                            │ JSON-RPC (stdio)
┌───────────────────────────▼─────────────────────────────┐
│              MCP SANDBOX SERVER (TypeScript)             │
│  ┌──────────────────────────────────────────────────┐   │
│  │               6 MCP Tool Handlers                 │   │
│  │  execute | session | install | file_ops |         │   │
│  │  inspect | security                               │   │
│  └──────────────────┬───────────────────────────────┘   │
│  ┌──────────────────▼───────────────────────────────┐   │
│  │         Core Orchestration Layer                  │   │
│  │  ContainerPool | PackageCache | SessionManager    │   │
│  └──────────────────┬───────────────────────────────┘   │
│  ┌──────────────────▼───────────────────────────────┐   │
│  │           Security Layer                          │   │
│  │  Seccomp | Capabilities | AuditLogger             │   │
│  └──────────────────┬───────────────────────────────┘   │
│  ┌──────────────────▼───────────────────────────────┐   │
│  │      Language Runtime Managers                    │   │
│  │  Python | TypeScript | JavaScript | Go | Rust     │   │
│  └──────────────────┬───────────────────────────────┘   │
└───────────────────┬─┴───────────────────────────────────┘
                    │ Dockerode API
┌───────────────────▼─────────────────────────────────────┐
│                   DOCKER ENGINE                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Pool       │  │  Active     │  │  Cached     │     │
│  │  Containers │  │  Sessions   │  │  Images     │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Security

### 6 Layers of Protection

1. **Pattern Validation** - Code blocklist (os, subprocess, eval, etc.)
2. **Seccomp Profiles** - Syscall filtering per language
3. **Capability Dropping** - CAP_DROP ALL, minimal CAP_ADD
4. **Network Isolation** - NetworkMode: none
5. **Resource Limits** - Memory, CPU, PIDs, ulimits
6. **Audit Logging** - All operations tracked

### Blocked Syscalls
- ptrace, mount, umount, kexec_load
- init_module, delete_module
- reboot, swapon/swapoff
- bpf, userfaultfd
- [Full list in seccomp.ts]

## Performance

| Metric | Value |
|--------|-------|
| Pool hit (warm) | **0ms** |
| Pool miss (cold) | ~80-100ms |
| Session create | ~85ms |
| Package cache hit | <1ms |
| Python execution | ~60ms |
| Bash execution | ~35ms |

## Testing

```bash
# Run all tests
npm run test:all

# Individual test suites
npm run test:runtimes    # 6 language tests
npm run test:mcp         # 19 MCP tool tests
npm run test:pool        # Container pool tests
npm run test:sessions    # Session manager tests
```

**Test Results:**
```
Total:  19
Passed: 19 ✅
Failed: 0
```

## Project Structure

```
multilang-pro/
├── src/
│   ├── mcp/
│   │   └── server.ts          # MCP server (6 tools)
│   ├── core/
│   │   ├── ContainerPool.ts   # 0ms container pooling
│   │   ├── PackageCache.ts    # SHA256 layer caching
│   │   └── SessionManager.ts  # TTL + GC sessions
│   ├── security/
│   │   ├── seccomp.ts         # Syscall profiles
│   │   └── AuditLogger.ts     # Operation logging
│   ├── runtimes/
│   │   ├── PythonRuntime.ts
│   │   ├── PythonMLRuntime.ts # ML-optimized
│   │   ├── TypeScriptRuntime.ts
│   │   ├── JavaScriptRuntime.ts
│   │   ├── GoRuntime.ts
│   │   ├── RustRuntime.ts
│   │   └── BashRuntime.ts
│   ├── docker/
│   │   ├── DockerClient.ts    # Dockerode wrapper
│   │   └── Container.ts       # Container abstraction
│   └── types/
│       └── index.ts           # TypeScript types
├── images/
│   ├── python/
│   │   ├── base.Dockerfile
│   │   └── ml.Dockerfile      # numpy, torch, mlx
│   ├── typescript/
│   ├── javascript/
│   ├── go/
│   ├── rust/
│   └── bash/
├── dist/                       # Compiled JS
├── package.json
├── tsconfig.json
└── PROGRESS.md                 # Development progress
```

## Requirements

- **Node.js**: >= 18.0.0
- **Docker Desktop**: Latest version
- **Disk Space**: ~10-20GB for images

## Development

```bash
# Watch mode
npm run dev

# Type checking
npm run typecheck

# Clean build
npm run clean && npm run build
```

## License

MIT

## Credits

Built with:
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- [Dockerode](https://github.com/apocas/dockerode)
- [Zod](https://github.com/colinhacks/zod)
- TypeScript, Node.js, Docker
