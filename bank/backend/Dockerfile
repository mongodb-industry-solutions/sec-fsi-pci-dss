# ── bankcore, the Open Banking bank (ASPSP) ───────────────────────
# Build context: repo root (docker compose sets context: .), like psp/backend/Dockerfile.
# Private service: no public ingress, no browser ever calls it.
# ──────────────────────────────────────────────────────────────────

FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# crypt_shared 8.2.4, the SAME version the backend downloads. bankcore runs Queryable Encryption
# against the SAME key vault, and a version mismatch between the two services surfaces as a generic
# 503, so the version is pinned here rather than resolved.
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
        wget -q https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-aarch64-enterprise-ubuntu2204-8.2.4.tgz -O crypt.tgz; \
    else \
        wget -q https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-x86_64-enterprise-ubuntu2204-8.2.4.tgz -O crypt.tgz; \
    fi && \
    tar -xzf crypt.tgz && \
    mkdir -p /usr/local/lib && \
    cp lib/mongo_crypt_v1.so /usr/local/lib/ && \
    rm -rf crypt.tgz lib

ENV MONGODB_CRYPT_SHARED_LIB_PATH=/usr/local/lib/mongo_crypt_v1.so
ENV PSP_BANKCORE_CRYPT_SHARED_LIB_PATH=/usr/local/lib/mongo_crypt_v1.so
ENV PORT=8080
ENV PSP_BANKCORE_PORT=8080

# ── Dependencies ──────────────────────────────────────────────────
# Shared workspace packages first: bankcore installs them through file:, and their prepare script
# builds dist/ during the install.
COPY packages/ packages/
RUN cd packages/eventbus && npm install
RUN cd packages/platform-links && npm install

COPY bank/backend/package.json bank/backend/
RUN cd bank/backend && npm install

# ── Source ────────────────────────────────────────────────────────
COPY bank/backend/ bank/backend/
COPY tsconfig.base.json ./

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
