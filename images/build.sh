#!/bin/bash
set -e

# Build all Docker images for MCP Multi-Language Sandbox

echo "🐳 Building Docker images for MCP Multi-Language Sandbox..."
echo ""

# Python
echo "🐍 Building Python images..."
docker build -t mcp-sandbox-python:base -f python/base.Dockerfile python/
docker build -t mcp-sandbox-python:ml -f python/ml.Dockerfile python/
echo "   ✅ Python images built"
echo ""

# TypeScript
echo "📘 Building TypeScript image..."
docker build -t mcp-sandbox-typescript:base -f typescript/base.Dockerfile typescript/
echo "   ✅ TypeScript image built"
echo ""

# JavaScript
echo "📙 Building JavaScript image..."
docker build -t mcp-sandbox-javascript:base -f javascript/base.Dockerfile javascript/
echo "   ✅ JavaScript image built"
echo ""

# Go
echo "🔵 Building Go image..."
docker build -t mcp-sandbox-go:base -f go/base.Dockerfile go/
echo "   ✅ Go image built"
echo ""

# Rust
echo "🦀 Building Rust image..."
docker build -t mcp-sandbox-rust:base -f rust/base.Dockerfile rust/
echo "   ✅ Rust image built"
echo ""

# Bash
echo "💻 Building Bash image..."
docker build -t mcp-sandbox-bash:base -f bash/base.Dockerfile bash/
echo "   ✅ Bash image built"
echo ""

echo "🎉 All images built successfully!"
echo ""
echo "Images created:"
docker images | grep mcp-sandbox
