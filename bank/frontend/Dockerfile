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
# Dev dependencies INCLUDED, and they have to be: tailwindcss, postcss, autoprefixer and typescript
# are all declared there and all needed by `next build`. This read `npm ci --omit=dev || npm install
# --omit=dev`; lockfiles are ignored by policy here, so the ci arm always failed and the fallback
# installed a tree with no build tooling. It passed locally only because no .dockerignore existed
# and `COPY . .` carried the developer's own node_modules into the image, devDependencies and all.
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
# The deploy platform probes this port, and the container answers on it in every environment.
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start"]
