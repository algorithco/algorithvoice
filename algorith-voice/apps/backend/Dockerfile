FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --filter @algorith-voice/backend...
COPY . .
RUN pnpm --filter @algorith-voice/shared-types build && pnpm --filter @algorith-voice/backend build
CMD ["node", "apps/backend/dist/server.js"]
