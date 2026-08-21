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
# VITE_API_URL defaults to http://localhost:3000/api (apps/web/src/lib/api.ts)
# — correct as-is here, since Vite env vars bake in at build time and the
# *browser* (not the container) is what resolves this URL, against whatever
# host port the api container is published on.
RUN npx nx build web --configuration=production

FROM nginx:alpine AS runtime
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
