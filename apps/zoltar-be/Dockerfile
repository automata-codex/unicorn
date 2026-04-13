# syntax=docker/dockerfile:1.7
#
# Development image for the zoltar-be NestJS app.
#
# Build context MUST be the repo root, NOT apps/zoltar-be — the package
# depends on workspace siblings, so `npm ci` needs the root lockfile and
# the sibling package.json files.
#
# Production stage is intentionally deferred to M6.

FROM node:22-alpine AS development

WORKDIR /app

# Copy every workspace package manifest first so the npm ci layer caches
# unless dependencies actually change.
COPY package.json package-lock.json ./
COPY apps/zoltar-be/package.json ./apps/zoltar-be/
COPY apps/zoltar-fe/package.json ./apps/zoltar-fe/
COPY apps/zoltar-playtest/package.json ./apps/zoltar-playtest/
COPY packages/auth-core/package.json ./packages/auth-core/
COPY packages/game-systems/package.json ./packages/game-systems/
COPY packages/rules-engine/package.json ./packages/rules-engine/
COPY packages/service-interfaces/package.json ./packages/service-interfaces/

RUN npm ci

# Then copy source. Honors .dockerignore so node_modules / .git / dist /
# .env are excluded.
COPY . .

# Build workspace packages so their dist/ outputs are available
RUN npm run --workspace=packages/auth-core build && \
    npm run --workspace=packages/service-interfaces build && \
    npm run --workspace=packages/game-systems build

WORKDIR /app/apps/zoltar-be

CMD ["npm", "run", "start:dev"]
