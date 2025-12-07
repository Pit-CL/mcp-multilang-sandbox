FROM oven/bun:latest

# Install pnpm
RUN npm install -g pnpm

# Create pnpm store directory
RUN mkdir -p /root/.pnpm-store

# Pre-install common packages
RUN pnpm add -g \
    typescript \
    @types/node \
    zod \
    axios

# Create non-root user
RUN adduser -D -u 1000 -s /bin/sh sandbox

# Create workspace with proper permissions
RUN mkdir -p /workspace && \
    chown -R sandbox:sandbox /workspace

# Set up pnpm cache for sandbox user
RUN mkdir -p /home/sandbox/.pnpm-store && \
    chown -R sandbox:sandbox /home/sandbox/.pnpm-store

WORKDIR /workspace
USER sandbox

CMD ["bun"]
