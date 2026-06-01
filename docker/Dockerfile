# syntax=docker/dockerfile:1

# --- Stage 1: Builder ---
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

# --- Stage 2: Runtime ---
FROM node:22-slim

LABEL maintainer="hookpipe"
LABEL description="Self-hosted webhook relay with transform pipelines"
LABEL version="1.0.0"

WORKDIR /app

ENV NODE_ENV=production

# Install curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r hookpipe && useradd -r -g hookpipe -s /bin/false hookpipe

# Copy built artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R hookpipe:hookpipe /app/data

USER hookpipe

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["node", "src/cli/index.js", "serve"]
CMD []
