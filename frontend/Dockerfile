# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio (monorepo con npm workspaces)
#   docker build -f frontend/Dockerfile -t cctv-frontend .

# ---------------------------------------------------------------- build
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --no-audit --no-fund
COPY frontend/ frontend/
RUN npm run build --workspace frontend

# -------------------------------------------------------------- runtime
# Nginx sin privilegios que solo sirve ficheros estáticos (TLS y proxy van en el contenedor nginx)
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
