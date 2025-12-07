FROM alpine:latest

# Install common shell utilities
RUN apk add --no-cache \
    bash \
    curl \
    jq \
    git \
    grep \
    sed \
    awk \
    findutils \
    coreutils

# Create non-root user
RUN adduser -D -u 1000 -s /bin/bash sandbox

# Create workspace with proper permissions
RUN mkdir -p /workspace && \
    chown -R sandbox:sandbox /workspace

WORKDIR /workspace
USER sandbox

CMD ["/bin/bash"]
