# ── Merchant demo app (Espresso Works) ────────────────────────────
# Build context: repo root, because the app installs the shared @leafypay/platform-links package
# via `file:../packages/platform-links` (same arrangement as the PSP and bank backends).
# ──────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Shared workspace package, built before the app installs it via file:. Consumed through its
# compiled dist, so it must be installed (its prepare script runs tsc) before the app's install.
COPY packages/platform-links/ packages/platform-links/
RUN cd packages/platform-links && npm install

# Install dependencies (layer cached unless package.json changes). The .npmrc travels with them:
# it is what installs the shared package copied rather than symlinked, which is what keeps it inside
# the app's Turbopack root.
COPY merchant/package*.json merchant/.npmrc merchant/
RUN cd merchant && npm install

# Copy source and build
COPY merchant/ merchant/
RUN cd merchant && npm run build

# node:20-alpine ships a built-in `node` user (uid 1000).
RUN chown -R node:node /app
USER node
WORKDIR /app/merchant

# Container listens on 8080 (same convention as the PSP frontend); host maps 8082:8080.
# Port is env-driven via PSP_MERCHANT_PORT so it can be overridden per environment.
EXPOSE 8080
ENV NODE_ENV=production
ENV PSP_MERCHANT_PORT=8080

# Invoke Next via its local bin path: a bare `next` is NOT on PATH under `sh -c` (only `npm run`
# adds node_modules/.bin), which crashed the container with "sh: next: not found" → CrashLoopBackOff.
CMD ["sh", "-c", "node_modules/.bin/next start -p ${PSP_MERCHANT_PORT:-8080}"]
