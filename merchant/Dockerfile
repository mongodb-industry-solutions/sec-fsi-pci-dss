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

CMD ["sh", "-c", "next start -p ${PSP_MERCHANT_PORT:-8080}"]
