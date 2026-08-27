FROM node:20-alpine
WORKDIR /app

# No NEXT_PUBLIC_* build arguments, deliberately.
#
# Everything this app needs is resolved at RUNTIME on the server: the bank's address and the signing secret
# are read inside route handlers, never inlined into the browser bundle. So one image is correct in every
# environment, and promoting from local to staging to production is a matter of environment variables rather
# than a rebuild. The PSP's frontend needs build arguments because it inlines public URLs for the browser;
# this one has none to inline, which is the same reason its browser never learns the bank's host.

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
# The deploy platform probes this port, and the container answers on it in every environment.
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start"]
