# Debian slim (glibc): argon2 native bindings + Prisma engines need
# OpenSSL/glibc — Alpine/musl would require a compiler toolchain.
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS installer
ENV CI=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY infra/prisma/package.json infra/prisma/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @algorith-voice/shared-types build
RUN pnpm --filter @algorith-voice/backend exec prisma generate --schema ../../infra/prisma/schema.prisma
RUN pnpm --filter @algorith-voice/backend build
# Prune devDependencies AFTER building (throwaway stage, keeps runner lean).
RUN pnpm install --frozen-lockfile --prod --filter @algorith-voice/backend...

FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=installer --chown=app:app /app/apps/backend/dist ./apps/backend/dist
COPY --from=installer --chown=app:app /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=installer --chown=app:app /app/node_modules ./node_modules
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/dist/server.js"]
