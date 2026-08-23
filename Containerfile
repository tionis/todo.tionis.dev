FROM node:24-bookworm-slim AS frontend

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY app ./app
COPY lib ./lib
COPY public ./public
COPY next.config.ts postcss.config.mjs tsconfig.json ./
# An unset public backend URL makes HTTP and WebSocket traffic same-origin.
RUN npm run build

FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3030 \
    DATA_DIR=/data \
    STATIC_DIR=/app/out
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=frontend /app/out ./out
COPY backend ./backend
RUN mkdir -p /data && chown -R node:node /data

USER node
VOLUME ["/data"]
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "backend/healthcheck.mjs"]
CMD ["node", "backend/server.mjs"]
