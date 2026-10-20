# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio (monorepo con npm workspaces)
#   docker build -f backend/Dockerfile -t cctv-backend .

# ---------------------------------------------------------------- build
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --no-audit --no-fund
COPY backend/ backend/
RUN npm run build --workspace backend

# ------------------------------------------------------- dependencias prod
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --omit=dev --no-audit --no-fund && npm cache clean --force

# -------------------------------------------------------------- runtime
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/
COPY backend/migrations ./backend/migrations
COPY backend/openapi.yaml ./backend/
WORKDIR /app/backend
# Usuario sin privilegios (uid 1000): los volúmenes /data/* deben pertenecerle
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
# Aplica las migraciones pendientes y arranca la API
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
