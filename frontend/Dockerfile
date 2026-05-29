FROM node:20-alpine
WORKDIR /app

# NEXT_PUBLIC_* variables are baked into the bundle at build time by Next.js.
# Pass the backend URL as a build argument so it is embedded in the client bundle.
# Override in docker-compose with: build.args.NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Install dependencies (layer cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "start"]
