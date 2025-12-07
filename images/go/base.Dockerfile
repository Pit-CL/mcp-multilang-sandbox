FROM golang:1.21-alpine

# Install build tools
RUN apk add --no-cache git gcc musl-dev

# Pre-install common Go packages
RUN go install github.com/gorilla/mux@latest && \
    go install github.com/stretchr/testify@latest && \
    go install github.com/spf13/cobra@latest

# Create non-root user
RUN adduser -D -u 1000 -s /bin/sh sandbox

# Create workspace with proper permissions
RUN mkdir -p /workspace && \
    chown -R sandbox:sandbox /workspace

# Set up Go cache directory
RUN mkdir -p /go/pkg/mod && \
    chown -R sandbox:sandbox /go

WORKDIR /workspace
USER sandbox

CMD ["go"]
