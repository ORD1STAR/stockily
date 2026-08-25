# Multi-stage build for the React (Vite) web app. Same "copy the whole
# monorepo, build with Nx" approach as apps/api/Dockerfile, since apps/web
# depends on Nx workspace libs by path.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY nx.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

# See apps/api/Dockerfile for why this is npm install, not npm ci.
RUN npm install
# VITE_API_URL bakes into the built JS at build time (Vite env vars aren't
# runtime-configurable) — the *browser* resolves this URL, not the
# container, so it must be the public address the app is served from.
# Defaults to http://localhost:3000/api (apps/web/src/lib/api.ts) when unset,
# which only works when the browser and the api container are the same host.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npx nx build web --configuration=production

FROM nginx:alpine AS runtime
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
