# ── PSP Backend ───────────────────────────────────────────────────
# Build context: repo root (docker compose sets context: .)
# Includes test infrastructure (vitest + test/) so the admin panel's
# /admin/run endpoint can execute unit and integration tests in-container.
#
# E2E tests (Playwright) require browser binaries not included here.
# To enable: RUN npx playwright install --with-deps chromium
# ──────────────────────────────────────────────────────────────────

FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download MongoDB Automatic Encryption Shared Library (mongo_crypt_v1.so)
# Requires glibc, this is why we use node:22-slim (Debian) instead of Alpine.
# crypt_shared 8.2.4 matches the local dev library (Windows 8.2.4) and adds support for the QE
# text-search query types (substringPreview / prefixPreview / suffixPreview) used by the v27 KYC
# search. 8.0.5 rejected those with "analyze_query failed: Enumeration value 'substringPreview' ...
# is not a valid value". Compatible with the mongodb + mongodb-client-encryption (7.2) pinned in
# backend/package.json. The Linux build is used here (the image is Linux); the version is what matters.
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
ENV PORT=8080
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ── Dependencies ──────────────────────────────────────────────────
# Root package.json provides test scripts and devDependencies (vitest, tsx).
COPY package.json ./
RUN npm install --ignore-scripts

# Shared workspace packages, built before the backend installs them via file: (v37). BOTH are needed:
# the backend imports @leafypay/eventbus and @leafypay/platform-links, and each is consumed through its
# compiled dist, so an uninstalled package fails the build with a missing type rather than at runtime.
COPY packages/ packages/
RUN cd packages/eventbus && npm install
RUN cd packages/platform-links && npm install

# Backend package.json — "fsi-pci-dss-demo": "file:.." now resolves to /app/
COPY backend/package.json backend/
RUN cd backend && npm install

# Frontend types for the admin panel type-check command
COPY frontend/package*.json frontend/
RUN cd frontend && npm install --ignore-scripts

# The bank workspace, because this image ORCHESTRATES the bank's setup: bin/setup.ts, bin/seed.ts,
# bin/validate.ts and bin/setup-drop.ts each run `npm run <script> --prefix bankcore`, and the admin
# panel exposes the same scripts. Without it every one of them fails here with an npm path error while
# working on a developer machine, which is the worst place for that difference to live.
COPY bankcore/package.json bankcore/
RUN cd bankcore && npm install

# ── Source & test infrastructure ──────────────────────────────────
COPY backend/ backend/
COPY test/ test/
COPY vitest.config.ts tsconfig.base.json ./
COPY frontend/src/ frontend/src/
COPY frontend/tsconfig.json frontend/
COPY bankcore/ bankcore/

# Create keys directory for volume mount (keys are never baked into the image).
RUN mkdir -p /app/backend/keys

# Generate seed data JSON files if not present in the build context.
RUN if [ ! -f backend/data/parties.json ]; then \
      echo "Generating seed data..." && \
      cd backend && npx ts-node bin/generate.ts; \
    else \
      echo "Seed data already present, skipping generation."; \
    fi

# Compile backend TypeScript
RUN cd backend && npm run build

# The bank's setup and seed run through ts-node from bin/, so no build of bankcore is needed here. The
# bank SERVICE is a separate image with its own Dockerfile; this is only the orchestration path.

# ── Runtime (non-root) ────────────────────────────────────────────
# node:20-slim ships a built-in `node` user (uid 1000).
# test-results/ needs write access for vitest JSON reporter.
RUN mkdir -p /app/test-results && chown -R node:node /app

USER node

EXPOSE 8080

ENV NODE_ENV=production
ENV PSP_SEED_DATA_DIR=/app/backend/data
ENV PSP_PROJECT_ROOT=/app

CMD ["node", "backend/dist/bin/server.js"]
