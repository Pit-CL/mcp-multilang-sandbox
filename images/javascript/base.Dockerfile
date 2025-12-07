FROM node:20-alpine

# Pre-install common packages globally
RUN npm install -g \
    lodash \
    axios \
    date-fns

# Create non-root user
RUN adduser -D -u 1000 -s /bin/sh sandbox

# Create workspace with proper permissions
RUN mkdir -p /workspace && \
    chown -R sandbox:sandbox /workspace

# Set up npm cache for sandbox user
RUN mkdir -p /home/sandbox/.npm && \
    chown -R sandbox:sandbox /home/sandbox/.npm

WORKDIR /workspace
USER sandbox

CMD ["node"]
