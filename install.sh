#!/bin/bash
# MCP Multi-Language Sandbox PRO - Installation Script

set -e

echo "🚀 Installing MCP Multi-Language Sandbox PRO..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js >= 18 is required (found: $(node -v))"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi
echo "✅ Docker is running"

# Navigate to project
cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Build
echo ""
echo "🔨 Building TypeScript..."
npm run build

# Pull Docker images
echo ""
echo "🐳 Pulling Docker images..."
docker pull python:3.11-slim
docker pull oven/bun:latest
docker pull node:20-alpine
docker pull golang:1.21-alpine
docker pull rust:1.75-alpine
docker pull alpine:latest

# Generate Claude settings config
echo ""
echo "📝 Generating Claude settings configuration..."

SETTINGS_CONFIG=$(cat <<EOF
{
  "mcpServers": {
    "multilang-sandbox": {
      "command": "node",
      "args": [
        "$PROJECT_DIR/dist/mcp/server.js"
      ],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
EOF
)

echo ""
echo "============================================"
echo "✅ Installation Complete!"
echo "============================================"
echo ""
echo "Add the following to your ~/.claude/settings.json:"
echo ""
echo "$SETTINGS_CONFIG"
echo ""
echo "============================================"
echo ""
echo "After adding to settings.json, restart Claude Code."
echo ""
echo "You can then use these tools in Claude:"
echo "  - sandbox_execute: Execute code"
echo "  - sandbox_session: Manage sessions"
echo "  - sandbox_install: Install packages"
echo "  - sandbox_file_ops: File operations"
echo "  - sandbox_inspect: View stats"
echo ""
