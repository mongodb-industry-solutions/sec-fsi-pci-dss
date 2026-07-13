FROM node:20-alpine
WORKDIR /app

# Install dependencies (layer cached unless package.json changes)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# node:20-alpine ships a built-in `node` user (uid 1000).
RUN chown -R node:node /app
USER node

# Container listens on 8080 (same convention as the PSP frontend); host maps 8082:8080.
# Port is env-driven via PSP_MERCHANT_PORT so it can be overridden per environment.
EXPOSE 8080
ENV NODE_ENV=production
ENV PSP_MERCHANT_PORT=8080

# Invoke Next via its local bin path: a bare `next` is NOT on PATH under `sh -c` (only `npm run`
# adds node_modules/.bin), which crashed the container with "sh: next: not found" → CrashLoopBackOff.
CMD ["sh", "-c", "node_modules/.bin/next start -p ${PSP_MERCHANT_PORT:-8080}"]
