# Contributing to Algorith Voice

Prereqs: Node 22+, pnpm 10+, Rust stable 1.80+, Docker.

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm install
pnpm --filter @algorith-voice/backend db:migrate
pnpm dev
```

## Rules

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- API shape changes start in `packages/shared-types` (Zod schema first), then backend + frontends atomically. No `z.any()`, `.strict()` on IPC boundaries.
- `pnpm format && pnpm lint && pnpm typecheck && pnpm test` must pass before PR.
- No secrets in PRs. No real audio fixtures — synthetic only.
- Monochrome only: CI rejects `red/blue/gradient` classes in app code.
- Security reports: see `SECURITY.md` (do not file public issues for vulns).
