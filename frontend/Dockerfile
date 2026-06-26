FROM node:20-alpine
WORKDIR /app

# NEXT_PUBLIC_* variables are baked into the bundle at build time by Next.js.
# Pass the backend URL as a build argument so it is embedded in the client bundle.
# Override in docker-compose with: build.args.NEXT_PUBLIC_PSP_URL_BACKEND
ARG NEXT_PUBLIC_PSP_URL_BACKEND=http://localhost:8081
ENV NEXT_PUBLIC_PSP_URL_BACKEND=$NEXT_PUBLIC_PSP_URL_BACKEND

ARG PSP_BACKEND_INTERNAL_URL=http://localhost:8081
ENV PSP_BACKEND_INTERNAL_URL=$PSP_BACKEND_INTERNAL_URL

# Install dependencies (layer cached unless package.json changes)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# node:20-alpine ships a built-in `node` user (uid 1000).
RUN chown -R node:node /app
USER node

EXPOSE 8080
ENV NODE_ENV=production

CMD ["npm", "start"]
