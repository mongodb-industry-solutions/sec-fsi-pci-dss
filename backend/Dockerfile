FROM node:20-alpine
WORKDIR /app

# Install dependencies first (layer cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Generate seed data JSON files if not present in the build context.
# If data/users.json already exists (pre-generated locally), this is skipped.
# ts-node and @faker-js/faker are devDependencies available at build time.
RUN if [ ! -f data/users.json ]; then \
      echo "Generating seed data..." && \
      npx ts-node data/generate.ts; \
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
