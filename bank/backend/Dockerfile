# ── bankcore, the Open Banking bank (ASPSP) ───────────────────────
# Build context: repo root (docker compose sets context: .), like psp/backend/Dockerfile.
# Private service: no public ingress, no browser ever calls it.
# ──────────────────────────────────────────────────────────────────

FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm 10.x, which this base image ships, cannot resolve a `file:` dependency when no lockfile is
# present: arborist crashes with "Cannot read properties of null (reading 'edgesOut')", which names
# nothing that is actually wrong. This repository ignores lockfiles by policy (.gitignore), so the
# CI context never has one, and every package.json here declares at least one file: link. Bisected
# in this image: the install fails on npm 10 without a lockfile and succeeds on npm 11 without one.
RUN npm install -g npm@11

# ── Dependencies ──────────────────────────────────────────────────
# Shared workspace packages first: bankcore installs them through file:, and their prepare script
# builds dist/ during the install. The shared tsconfig comes with them: every package tsconfig
# extends it, and tsc falls back to an ES5 target without it, which fails on ordinary Set iteration.
# Copied before the crypt_shared download below: that step reads the recommended version FROM the
# compiled @ist-sec/mongo-compat, so the deployment and installation steps stay driven by the same
# source instead of a literal copied into this Dockerfile and the PSP's.
COPY tsconfig.base.json ./
COPY packages/ packages/
RUN cd packages/eventbus && npm install
RUN cd packages/platform-links && npm install
RUN cd packages/mongo-compat && npm install
RUN cd packages/giam-client && npm install

# crypt_shared, the SAME version the PSP backend downloads (@ist-sec/mongo-compat's
# MONGODB_CRYPT_SHARED_LIB_VERSION). bankcore runs Queryable Encryption against the SAME key
# vault, and a version mismatch between the two services surfaces as a generic 503.
RUN ARCH=$(dpkg --print-architecture) && \
    CRYPT_VERSION=$(node -e "console.log(require('./packages/mongo-compat/dist').MONGODB_CRYPT_SHARED_LIB_VERSION)") && \
    echo "crypt_shared target: $CRYPT_VERSION" && \
    if [ "$ARCH" = "arm64" ]; then \
        wget -q https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-aarch64-enterprise-ubuntu2204-${CRYPT_VERSION}.tgz -O crypt.tgz; \
    else \
        wget -q https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-x86_64-enterprise-ubuntu2204-${CRYPT_VERSION}.tgz -O crypt.tgz; \
    fi && \
    tar -xzf crypt.tgz && \
    mkdir -p /usr/local/lib && \
    cp lib/mongo_crypt_v1.so /usr/local/lib/ && \
    rm -rf crypt.tgz lib

ENV MONGODB_CRYPT_SHARED_LIB_PATH=/usr/local/lib/mongo_crypt_v1.so
ENV PSP_BANKCORE_CRYPT_SHARED_LIB_PATH=/usr/local/lib/mongo_crypt_v1.so
ENV PORT=8080
ENV PSP_BANKCORE_PORT=8080

COPY bank/backend/package.json bank/backend/
RUN cd bank/backend && npm install

# ── Source ────────────────────────────────────────────────────────
COPY bank/backend/ bank/backend/

RUN cd bank/backend && npm run build

# The notification signing key is generated on first use and lives here. Created before the ownership
# change below, so the non-root user can write it. NOT baked into the image: a signing key in an image is
# a signing key in a registry.
RUN mkdir -p /app/bank/backend/keys

# ── Runtime (non-root) ────────────────────────────────────────────
RUN chown -R node:node /app
USER node

EXPOSE 8080

ENV NODE_ENV=production
ENV PSP_BANKCORE_SEED_DATA_DIR=/app/bank/backend/data

CMD ["node", "bank/backend/dist/bin/server.js"]
