FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download MongoDB Automatic Encryption Shared Library (mongo_crypt_v1.so)
# Requires glibc — this is why we use node:20-slim (Debian) instead of Alpine.
# Version 8.0.5 is compatible with MongoDB Driver 6.x
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
        wget -q https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-aarch64-enterprise-ubuntu2204-8.0.5.tgz -O crypt.tgz; \
    else \
        wget -q https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-x86_64-enterprise-ubuntu2204-8.0.5.tgz -O crypt.tgz; \
    fi && \
    tar -xzf crypt.tgz && \
    mkdir -p /usr/local/lib && \
    cp lib/mongo_crypt_v1.so /usr/local/lib/ && \
    rm -rf crypt.tgz lib

ENV MONGODB_CRYPT_SHARED_LIB_PATH=/usr/local/lib/mongo_crypt_v1.so

# Install dependencies first (layer cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Generate seed data JSON files if not present in the build context.
# If data/parties.json already exists (pre-generated locally), this is skipped.
# ts-node and @faker-js/faker are devDependencies available at build time.
RUN if [ ! -f data/parties.json ]; then \
      echo "Generating seed data..." && \
      npx ts-node bin/generate.ts; \
    else \
      echo "Seed data already present, skipping generation."; \
    fi

# Compile TypeScript
RUN npm run build

EXPOSE 3001

# ts-node retained for: npm run seed / npm run setup:db inside the container
ENV NODE_ENV=production
ENV SEED_DATA_DIR=/app/data

CMD ["node", "dist/src/server.js"]
