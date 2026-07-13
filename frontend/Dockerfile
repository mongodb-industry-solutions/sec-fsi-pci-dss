FROM node:20-alpine
WORKDIR /app

# NEXT_PUBLIC_* variables are baked into the bundle at build time by Next.js.
# PUBLIC  = external URL (display: webhook URLs, API docs links)
# PRIVATE = internal URL (K8s service); its presence activates proxy mode
ARG NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC=http://localhost:8081
ENV NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC=$NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC

ARG NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE
ENV NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE=$NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE

# MERCHANT = external merchant demo app URL (simulator "Simulate Merchant" card)
ARG NEXT_PUBLIC_PSP_URL_MERCHANT=http://localhost:8082
ENV NEXT_PUBLIC_PSP_URL_MERCHANT=$NEXT_PUBLIC_PSP_URL_MERCHANT

# MERCHANT_PRIVATE = in-cluster merchant service URL, used server-side by next.config rewrites so the
# admin monitoring page probes /merchant-health same-origin (no CORS / public-ingress dependency).
ARG NEXT_PUBLIC_PSP_URL_MERCHANT_PRIVATE
ENV NEXT_PUBLIC_PSP_URL_MERCHANT_PRIVATE=$NEXT_PUBLIC_PSP_URL_MERCHANT_PRIVATE

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
