FROM rust:1.75-alpine

# Install build tools
RUN apk add --no-cache musl-dev

# Install cargo-edit for easier dependency management
RUN cargo install cargo-edit

# Pre-install common crates globally
RUN cargo install serde --features derive || true && \
    cargo install tokio || true

# Create non-root user
RUN adduser -D -u 1000 -s /bin/sh sandbox

# Create workspace with proper permissions
RUN mkdir -p /workspace && \
    chown -R sandbox:sandbox /workspace

# Set up Cargo cache directory
RUN mkdir -p /usr/local/cargo/registry && \
    chown -R sandbox:sandbox /usr/local/cargo

WORKDIR /workspace
USER sandbox

CMD ["rustc"]
