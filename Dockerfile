# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Install with the lockfile first so dependency layers cache across code edits.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build


# ---- production dependencies ---------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


# ---- runtime --------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
  PORT=8080 \
  HOST=0.0.0.0 \
  BOTC_DATA_DIR=/data

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
COPY package.json ./
COPY public ./public

# VAPID keys and in-progress games live here; keep it on a volume so a restart
# does not drop a game that is halfway through the night.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/config" > /dev/null || exit 1

CMD ["node", "dist/index.js"]
