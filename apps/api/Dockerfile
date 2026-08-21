# Multi-stage build for the NestJS API. Copies the whole monorepo in (Nx
# workspace libs are consumed by path, not published packages), builds with
# Nx, then ships node_modules + the built output — this repo's webpack config
# has generatePackageJson disabled, so a trimmed runtime node_modules isn't
# straightforward yet; shipping the full one is the simple-and-correct choice
# for now, at the cost of image size. Revisit once that's worth optimizing.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY nx.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

# npm ci (not used here) requires the lockfile to match node_modules
# *exactly*, including platform-specific optional dependencies — this
# lockfile was last touched on Windows, so a strict match fails on Linux/
# alpine's different optional-dependency resolution. npm install reconciles
# that instead of failing on it.
RUN npm install
# Generate the Prisma client (with its query-engine binary) against this same
# alpine (musl) base *before* building, so it matches the runtime stage below.
RUN npx prisma generate --schema packages/infra-db/prisma/schema.prisma
RUN npx nx build api --configuration=production

FROM node:22-alpine AS runtime
WORKDIR /app
# Deliberately NOT setting NODE_ENV=production here: JwtConfigModule refuses
# to boot in production without a real JWT_SECRET, and this image is meant
# for local/demo use with the .env.example default out of the box. Set
# NODE_ENV=production + a real secret via compose/.env for anything beyond that.

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# node_modules/@org/* are symlinks to ../../packages/* (npm workspaces) —
# the bundle requires those at runtime rather than inlining them, so the
# actual package sources (with their own build output) must exist here too.
COPY --from=builder /app/packages ./packages

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
