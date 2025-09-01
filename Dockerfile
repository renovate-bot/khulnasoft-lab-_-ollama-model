# --- Build Stage ---
FROM node:24-slim AS builder

WORKDIR /app

# Install build dependencies with no-cache and clean up in one layer
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo "--- Checking network connectivity to google.com ---" && ping -c 3 google.com || echo "Ping to google.com failed." && \
    echo "--- Checking network connectivity to archive.ubuntu.com ---" && ping -c 3 archive.ubuntu.com || echo "Ping to archive.ubuntu.com failed." && \
    echo "--- Displaying /etc/resolv.conf ---" && cat /etc/resolv.conf && \
    for i in $(seq 1 5); do apt-get update --allow-releaseinfo-change && break || sleep 5; done && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy only package files first to leverage Docker cache
COPY package*.json ./
COPY .npmrc* ./

# Check if npm is available
RUN which npm

# Install dependencies with clean cache
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --prefer-offline --no-audit --progress=false


# Copy the rest of the application files
COPY . .

# --- Production Stage ---
FROM node:24-slim

# Set secure defaults
ENV NODE_ENV=production
ENV NPM_CONFIG_PRODUCTION=true
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false

# Create non-root user with secure defaults
RUN groupadd -r nodejs && \
    useradd -r -g nodejs -d /home/nodejs -m -s /bin/false nodejs && \
    mkdir -p /app && \
    chown -R nodejs:nodejs /app

WORKDIR /app

# Install only necessary runtime dependencies
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo "--- Checking network connectivity to google.com ---" && ping -c 3 google.com || echo "Ping to google.com failed." && \
    echo "--- Checking network connectivity to archive.ubuntu.com ---" && ping -c 3 archive.ubuntu.com || echo "Ping to archive.ubuntu.com failed." && \
    echo "--- Displaying /etc/resolv.conf ---" && cat /etc/resolv.conf && \
    for i in $(seq 1 5); do apt-get update --allow-releaseinfo-change && break || sleep 5; done && \
    apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps with clean cache
COPY --from=builder /app/package*.json ./
# Check if npm is available
RUN which npm
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --prefer-offline --no-audit --progress=false && \
    npm cache clean --force

# Copy built application files with proper permissions
COPY --from=builder --chown=nodejs:nodejs /app .

# Set secure permissions
RUN find /app -type d -exec chmod 755 {} + && \
    find /app -type f -exec chmod 644 {} + && \
    chmod +x /app/server.js && \
    chown -R nodejs:nodejs /app /home/nodejs

# Switch to non-root user
USER nodejs

# Create necessary directories with correct permissions
RUN mkdir -p /home/nodejs/.cache && \
    chown -R nodejs:nodejs /home/nodejs/.cache

# Set environment variables for runtime
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV NODE_NO_WARNINGS=1
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Add healthcheck with appropriate timeouts
HEALTHCHECK --interval=30s \
            --timeout=10s \
            --start-period=30s \
            --retries=3 \
            CMD curl -f http://localhost:3000/health || exit 1

# Use node process manager for better process management
CMD ["node", "--trace-warnings", "server.js"]
