# ------------------------------------------------------------------
# Algorith Voice — web image (Next.js standalone).
#
#   docker build -f apps/web/Dockerfile -t algorith-voice-web .
#   docker run -p 3000:3000 -e API_URL=http://backend:3001 algorith-voice-web
#
# Build context MUST be the repo root (monorepo: ui + shared-types).
# The web app is a BFF: browsers hit same-origin /api/* routes, which
# proxy server-side to API_URL. Only API_URL (server) + NEXT_PUBLIC_*
# (build-time, non-secret) are needed — never backend secrets.
# ------------------------------------------------------------------
ARG NODE_VERSION=22-bookworm-slim
FROM node:${NODE_VERSION} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

# ---- builder: install + compile (one stage — pnpm symlinks
# per-workspace node_modules, so install + build share one filesystem) ----
FROM base AS builder
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY tsconfig.base.json biome.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY apps/desktop-tauri/package.json apps/desktop-tauri/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY infra/prisma/package.json infra/prisma/
# Reproducible install of ONLY the web closure (web + ui + shared-types):
# skips backend/desktop toolchains this image never uses. Native build
# scripts (esbuild, msgpackr-extract) are allowlisted via
# `onlyBuiltDependencies` in pnpm-workspace.yaml.
RUN pnpm install --frozen-lockfile \
  --filter @algorith-voice/web \
  --filter @algorith-voice/ui \
  --filter @algorith-voice/shared-types
COPY packages ./packages
COPY apps/web ./apps/web
# NEXT_PUBLIC_* is inlined at build time (client bundle). Pass via
# --build-arg; defaults match infra/docker-compose.yml (127.0.0.1 keeps
# cookies/CORS coherent and satisfies the backend's no-localhost rule).
ARG NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
ARG NEXT_PUBLIC_STRIPE_PRICE_PRO=""
ARG NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY=""
ARG NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY=""
ARG NEXT_PUBLIC_GITHUB_REPO=algorithco/algorithvoice
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_STRIPE_PRICE_PRO=${NEXT_PUBLIC_STRIPE_PRICE_PRO} \
    NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY=${NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY} \
    NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY=${NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY} \
    NEXT_PUBLIC_GITHUB_REPO=${NEXT_PUBLIC_GITHUB_REPO}
RUN pnpm --filter @algorith-voice/shared-types build \
  && pnpm --filter @algorith-voice/ui build \
  && pnpm --filter @algorith-voice/web build \
  && mkdir -p ./apps/web/public

# ---- runner: minimal standalone server, non-root, signal-safe ----
FROM node:${NODE_VERSION} AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 app
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Standalone output bundles its own pruned node_modules + server.js.
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
# Public assets are NOT part of the standalone trace — copy explicitly
# (builder guarantees the dir exists, even when empty).
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public

USER app
EXPOSE 3000
# Liveness on `/` (static shell renders even if the API is down).
# Readiness / API health is `GET /api/health` (proxies to backend /health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
