# One file for all three images. It is a workspace monorepo, so every image needs the root
# lockfile and packages/shared anyway, and this way install and build run once.

# bookworm, not alpine: better-sqlite3 ships glibc prebuilds, on musl it may fall back to compiling.
FROM node:24-bookworm-slim AS base
WORKDIR /app

# Manifests only, so the install layer is reused until a dependency changes.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
COPY apps/web/package.json apps/web/
# --ignore-scripts: better-sqlite3 13 ships its prebuilds in the tarball with gypfile false, the
# lockfile does not record that, so without the flag npm sees binding.gyp and tries node-gyp.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build

# npm ci checks the lockfile against every workspace, so the web manifest has to be here
# even though nothing of web gets installed.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
COPY apps/web/package.json apps/web/
# --ignore-scripts for the same reason as in deps.
RUN npm ci --ignore-scripts --omit=dev -w @nexus/shared -w @nexus/api -w @nexus/worker

FROM base AS node-runtime
# chown before USER node: a named volume takes its ownership from the image directory the
# first time it is created, so the services can write to /data without a root init step.
RUN mkdir -p /data/uploads/tmp && chown -R node:node /data
COPY --from=prod-deps /app/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
# node_modules/@nexus/shared is a symlink to here, so the package has to sit at the same path.
COPY --from=prod-deps /app/packages/shared ./packages/shared
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
USER node

FROM node-runtime AS api
COPY --from=prod-deps /app/services/api ./services/api
COPY --from=build /app/services/api/dist ./services/api/dist
WORKDIR /app/services/api
CMD ["node", "dist/index.js"]

FROM node-runtime AS worker
COPY --from=prod-deps /app/services/worker ./services/worker
COPY --from=build /app/services/worker/dist ./services/worker/dist
WORKDIR /app/services/worker
CMD ["node", "dist/index.js"]

FROM nginx:1.30.5-alpine AS web
# Replaces the stock server block, which would otherwise also claim port 80.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
