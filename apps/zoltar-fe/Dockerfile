# syntax=docker/dockerfile:1.7
#
# Development image for the zoltar-fe Svelte SPA.
#
# Build context MUST be the repo root, NOT apps/zoltar-fe, because npm
# workspaces installs are rooted at the monorepo root.

FROM node:22-alpine AS development

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/zoltar-be/package.json ./apps/zoltar-be/
COPY apps/zoltar-fe/package.json ./apps/zoltar-fe/
COPY apps/zoltar-playtest/package.json ./apps/zoltar-playtest/
COPY packages/auth-core/package.json ./packages/auth-core/
COPY packages/game-systems/package.json ./packages/game-systems/
COPY packages/rules-engine/package.json ./packages/rules-engine/
COPY packages/service-interfaces/package.json ./packages/service-interfaces/

RUN npm ci

COPY . .

WORKDIR /app/apps/zoltar-fe

CMD ["npm", "run", "dev"]
