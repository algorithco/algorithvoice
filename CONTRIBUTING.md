# Contributing to Algorith Voice

Prereqs: Node 22+, pnpm 10+, Rust stable 1.80+, Docker.

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm install
pnpm --filter @algorith-voice/backend db:migrate
pnpm dev
```

## Branching

```
feature/* → develop → release/vX.Y.Z → main → tag vX.Y.Z
hotfix/*  → main → back-merge develop
```

- Create from `develop`: `git checkout -b feature/my-change develop && git push -u origin feature/my-change && gh pr create --base develop`
- Promote: `gh workflow run promote-release --ref develop -f version=0.2.0` → PR `release/v0.2.0` → `main`
- Release: `git tag v0.2.0 && git push origin v0.2.0` → `release.yml` + `release-desktop.yml` attach artifacts. Or `gh workflow run release --ref main -f version=0.2.0`
- Direct pushes to `main` are blocked by `branch-guard.yml` (free-tier workaround — upgrade to Pro/public for native rulesets). CI must be green before merge.

## Rules

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- API shape changes start in `packages/shared-types` (Zod schema first), then backend + frontends atomically. No `z.any()`, `.strict()` on IPC boundaries.
- `pnpm format && pnpm lint && pnpm typecheck && pnpm test` must pass before PR.
- No secrets in PRs. No real audio fixtures — synthetic only.
- Monochrome only: CI rejects `red/blue/gradient` classes in app code.
- Security reports: see `SECURITY.md` (do not file public issues for vulns).
