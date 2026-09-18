# ------------------------------------------------------------------
# Algorith Voice — backend image (API + worker share this image).
#
#   API:    docker build -f apps/backend/Dockerfile -t algorith-voice-backend .
#           docker run -p 3001:3001 algorith-voice-backend
#   Worker: docker run algorith-voice-backend node apps/backend/dist/queues/worker.js
#
# Build context MUST be the repo root (monorepo: workspace + shared-types).
# Debian bookworm-slim (glibc): argon2 native bindings + Prisma engines
# need OpenSSL/glibc — Alpine/musl would require a compiler toolchain.
# ------------------------------------------------------------------
ARG NODE_VERSION=22-bookworm-slim
# Prisma CLI for one-shot migrate jobs and Fly release commands.
# MUST match the resolved version in pnpm-lock.yaml (check: prisma@x.y.z).
ARG PRISMA_VERSION=6.19.3
FROM node:${NODE_VERSION} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

# ---- builder: install (one stage — pnpm symlinks per-workspace
# node_modules, so install + compile must share the same filesystem) ----
FROM base AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Workspace manifests first for a cacheable dependency layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY tsconfig.base.json biome.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY infra/prisma/package.json infra/prisma/
# Reproducible install of ONLY the backend closure (backend + shared-types +
# the prisma schema package): skips web/desktop/remotion toolchains this
# image never uses. @algorith-voice/prisma MUST be included: `prisma
# generate` resolves the client/CLI from the schema's own package dir and
# falls back to a broken auto-install when it is missing (see prisma#9848).
# Native build scripts (argon2, Prisma engines) are allowlisted via
# `onlyBuiltDependencies` in pnpm-workspace.yaml.
RUN pnpm install --frozen-lockfile \
  --filter @algorith-voice/backend \
  --filter @algorith-voice/shared-types \
  --filter @algorith-voice/prisma
COPY packages ./packages
COPY infra/prisma ./infra/prisma
COPY apps/backend ./apps/backend
RUN pnpm --filter @algorith-voice/shared-types build \
  && pnpm --filter @algorith-voice/backend exec prisma generate --schema ../../infra/prisma/schema.prisma \
  && pnpm --filter @algorith-voice/backend build
# NOTE: no `pnpm install --prod` prune here — deliberately. pnpm refuses
# unattended node_modules removal without CI=true/a TTY, and forcing it
# reshuffles .pnpm store keys (dev peers drop out), orphaning the generated
# Prisma client that lives inside the store next to @prisma/client. The
# filtered closure above (~400 pkgs vs ~700 workspace-wide) is already lean;
# correctness beats a few hundred MB. The runner copies this tree as-is.
RUN mkdir -p ./packages/shared-types/node_modules ./apps/backend/node_modules

# ---- runner: minimal prod runtime, non-root, signal-safe ----
FROM node:${NODE_VERSION} AS runner
ARG PRISMA_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g prisma@${PRISMA_VERSION} --no-audit --no-fund \
  && npm cache clean --force \
  && useradd -m -u 1001 app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

# Runtime layout mirrors the repo so `dist` relative imports + workspace
# symlinks resolve exactly like local `pnpm build` output.
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=app:app /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder --chown=app:app /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=app:app /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=app:app /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=builder --chown=app:app /app/apps/backend/node_modules ./apps/backend/node_modules
# Prisma schema + migrations ship with the image so one-shot migrate jobs
# (`prisma migrate deploy`) and Fly release commands work offline.
COPY --from=builder --chown=app:app /app/infra/prisma/schema.prisma ./infra/prisma/schema.prisma
COPY --from=builder --chown=app:app /app/infra/prisma/migrations ./infra/prisma/migrations
# The generated client lives inside the .pnpm store next to @prisma/client
# (NOT in a top-level .prisma dir). A missing client is a hard boot crash,
# so fail the build now if generate produced nothing.
RUN test -n "$(find node_modules/.pnpm -maxdepth 4 -type d -path '*node_modules/.prisma/client' | head -1)" \
  || (echo "FATAL: Prisma client missing after build" && exit 1)

USER app
EXPOSE 3001
# Liveness only (/health never touches DB/Redis) so a transient outage
# doesn't restart the container. Orchestrators gate traffic on /ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/backend/dist/server.js"]
