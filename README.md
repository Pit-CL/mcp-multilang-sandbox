# MCP Multi-Language Sandbox

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-green.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-19%2F19%20passing-brightgreen.svg)]()

> Execute code securely in 6 programming languages with Docker isolation, designed for [Claude Code](https://claude.com/claude-code) via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

## What is this?

A local MCP server that lets Claude execute code in isolated Docker containers. Think of it as your own private code sandbox - **100% free**, **100% local**, no cloud dependencies.

**Why use this instead of cloud sandboxes?**
- **Free**: No per-execution costs (vs ~$0.10/run on cloud services)
- **Fast**: 0ms container acquisition with pooling (vs 2-5s cold starts)
- **Private**: Code never leaves your machine
- **Customizable**: Add your own languages, packages, security rules

## Features

- **6 Languages**: Python, TypeScript, JavaScript, Go, Rust, Bash
- **Container Pooling**: Pre-warmed containers for instant execution
- **Package Caching**: Install once, reuse forever (SHA256-based)
- **ML Runtime**: numpy, pandas, sklearn, torch, mlx pre-installed
- **Security**: Seccomp profiles, capability dropping, audit logging
- **Sessions**: Persistent state with TTL and auto-cleanup

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) >= 18.0.0
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Claude Code CLI](https://claude.com/claude-code) (optional, for MCP integration)

### Installation

```bash
# Clone the repository
git clone https://github.com/Pit-CL/mcp-multilang-sandbox.git
cd mcp-multilang-sandbox

# Install dependencies
npm install

# Build
npm run build

# Run tests (optional)
npm run test:mcp
```

### Add to Claude Code

```bash
# Add as MCP server
claude mcp add multilang-sandbox node /path/to/mcp-multilang-sandbox/dist/mcp/server.js

# Verify it's connected
claude mcp list
# Should show: multilang-sandbox ✓ Connected
```

### Manual Configuration

Add to your Claude settings (`~/.claude.json` or VS Code settings):

```json
{
  "mcpServers": {
    "multilang-sandbox": {
      "command": "node",
      "args": ["/path/to/mcp-multilang-sandbox/dist/mcp/server.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## Usage

Once configured, Claude can use these tools:

### Execute Code

```typescript
// Python
sandbox_execute({ language: 'python', code: 'print("Hello!")' })

// TypeScript
sandbox_execute({ language: 'typescript', code: 'console.log("Hello!")' })

// With ML libraries (numpy, pandas, sklearn, torch)
sandbox_execute({
  language: 'python',
  code: 'import numpy as np; print(np.array([1,2,3]))',
  ml: true
})
```

### Persistent Sessions

```typescript
// Create a session
sandbox_session({ action: 'create', name: 'my-project', language: 'python' })

// Execute in session (state persists)
sandbox_execute({ language: 'python', code: 'x = 42', session: 'my-project' })
sandbox_execute({ language: 'python', code: 'print(x)', session: 'my-project' })  // prints 42

// Install packages
sandbox_install({ session: 'my-project', packages: ['pandas', 'requests'] })

// Cleanup
sandbox_session({ action: 'destroy', name: 'my-project' })
```

### File Operations

```typescript
// Write a file
sandbox_file_ops({ session: 'my-project', operation: 'write', path: 'data.csv', content: 'a,b\n1,2' })

// Read it back
sandbox_file_ops({ session: 'my-project', operation: 'read', path: 'data.csv' })
```

### System Stats

```typescript
// View pool, cache, and session stats
sandbox_inspect({ target: 'all' })

// Security audit
sandbox_security({ action: 'stats' })
```

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `sandbox_execute` | Execute code in any supported language |
| `sandbox_session` | Create/list/pause/resume/destroy sessions |
| `sandbox_install` | Install packages with caching |
| `sandbox_file_ops` | Read/write/list/delete files in sessions |
| `sandbox_inspect` | View system stats (pool, cache, sessions) |
| `sandbox_security` | View audit logs and security events |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claude / MCP Client                   │
└───────────────────────────┬─────────────────────────────┘
                            │ JSON-RPC (stdio)
┌───────────────────────────▼─────────────────────────────┐
│                    MCP Sandbox Server                    │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Tools: execute | session | install | file_ops     │ │
│  │         inspect | security                          │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  Core: ContainerPool | PackageCache | Sessions     │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  Security: Seccomp | Capabilities | AuditLogger    │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  Runtimes: Python | TS | JS | Go | Rust | Bash     │ │
│  └────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────┘
                            │ Dockerode
┌───────────────────────────▼─────────────────────────────┐
│                      Docker Engine                       │
│    [Container Pool]  [Active Sessions]  [Image Cache]   │
└─────────────────────────────────────────────────────────┘
```

## Security

### 6 Layers of Protection

1. **Code Validation** - Pattern blocklist (os, subprocess, eval, exec)
2. **Seccomp Profiles** - Syscall filtering per language
3. **Capability Dropping** - CAP_DROP ALL
4. **Network Isolation** - NetworkMode: none
5. **Resource Limits** - Memory, CPU, PIDs, ulimits
6. **Audit Logging** - All operations tracked

### Blocked Syscalls
`ptrace`, `mount`, `umount`, `kexec_load`, `init_module`, `delete_module`, `reboot`, `bpf`, `userfaultfd`, and [more](src/security/seccomp.ts)

## Performance

| Metric | Value |
|--------|-------|
| Pool hit (warm) | **0ms** |
| Pool miss (cold) | ~80-100ms |
| Session create | ~85ms |
| Package cache hit | <1ms |
| Python execution | ~60ms |
| Bash execution | ~35ms |

## Development

```bash
# Watch mode (auto-rebuild)
npm run dev

# Type checking
npm run typecheck

# Run tests
npm run test:all        # All tests
npm run test:mcp        # MCP tools (19 tests)
npm run test:runtimes   # Language runtimes

# Clean build
npm run clean && npm run build
```

## Project Structure

```
src/
├── mcp/server.ts           # MCP server & tool handlers
├── core/
│   ├── ContainerPool.ts    # Pre-warmed container pooling
│   ├── PackageCache.ts     # SHA256-based package caching
│   └── SessionManager.ts   # Persistent sessions with TTL
├── security/
│   ├── seccomp.ts          # Syscall filtering profiles
│   └── AuditLogger.ts      # Operation audit logging
├── runtimes/
│   ├── PythonRuntime.ts    # + PythonMLRuntime for ML
│   ├── TypeScriptRuntime.ts
│   ├── JavaScriptRuntime.ts
│   ├── GoRuntime.ts
│   ├── RustRuntime.ts
│   └── BashRuntime.ts
└── docker/
    ├── DockerClient.ts     # Dockerode wrapper
    └── Container.ts        # Container abstraction
```

## Contributing

Issues and PRs welcome! This started as a personal project to replace cloud sandboxes with something local and free.

## License

MIT

## Credits

Built with [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk), [Dockerode](https://github.com/apocas/dockerode), and [Zod](https://github.com/colinhacks/zod).
