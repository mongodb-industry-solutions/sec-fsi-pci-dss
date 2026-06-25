FROM node:20-alpine
WORKDIR /app

# NEXT_PUBLIC_* variables are baked into the bundle at build time by Next.js.
# Pass the backend URL as a build argument so it is embedded in the client bundle.
# Override in docker-compose with: build.args.NEXT_PUBLIC_PSP_URL_BACKEND
ARG NEXT_PUBLIC_PSP_URL_BACKEND=http://localhost:8081
ENV NEXT_PUBLIC_PSP_URL_BACKEND=$NEXT_PUBLIC_PSP_URL_BACKEND

# Install dependencies (layer cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 8080
ENV NODE_ENV=production

CMD ["npm", "start"]
