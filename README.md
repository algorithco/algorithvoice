# Algorith Voice

Push-to-talk voice dictation: hold a hotkey, speak, text appears in the focused app.
Monochrome (black/white/gray only), offline-first, privacy-respecting.

```
Desktop (Tauri 2 + Rust) <— WS/REST —> Backend (Fastify 5) <— BFF —> Web (Next.js 16)
   whisper.cpp local                 Voxtral Realtime primary +
                                     OpenRouter Parakeet fallback
```

## Monorepo

```
.  (repo root)
├── apps/desktop   # Tauri 2 (Rust + React)
├── apps/web       # Next.js 16 marketing + dashboard
├── apps/backend   # Fastify 5 API + WS
├── packages/shared-types  # Zod contracts (single source of truth)
├── packages/ui    # monochrome React components
├── infra/         # docker-compose + prisma
└── .github/workflows/
```

See `DECISIONS.md` for locked choices (Next 16, Fly.io, Voxtral primary, free 60min/mo, 3 seats, etc.).

## Quickstart (Phase 0)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

- Backend: http://localhost:3001/health
- Web: http://localhost:3000
- Desktop: `pnpm --filter @algorith-voice/desktop tauri:dev` (needs Rust + system deps)

## Design system

Website (V5 modern monochrome): `#000/#FFF` + surface/raised/border/text tokens per mode. Inter throughout, JetBrains Mono accents, 6/8/16px radii, scroll-reveal + waveform signature motion, FAQ accordion. Desktop app keeps the v1 instrument tokens (4px controls / 8px cards). Full spec: `apps/web/design-system`.

## Privacy

Local mode = audio never leaves device. Cloud STT + sync are opt-in. No telemetry by default. See `PRIVACY.md`.

## Branching & Releases

```
feature/*  ──┐
fix/*      ──┤→  develop  ──→  release/vX.Y.Z  ──PR──→  main  ──tag vX.Y.Z──→ Release + Desktop builds
chore/*    ──┘                         ↑
                               gh workflow run promote-release --ref develop -f version=0.2.0
```

- **Never push directly to `main`** — `.github/workflows/branch-guard.yml` blocks it on free-tier private repos (upgrade to Pro/public for native rulesets). Push to `feature/*` → PR to `develop` → PR to `main` via `release/*`.
- **CI** runs on PRs to `main`/`develop`/`release/*` and pushes to `develop`/`release/*`/`hotfix/*` (`ci.yml`).
- **Backend deploy** triggers on pushes to `main` + tags `v*.*.*` + GitHub Releases (`deploy-backend.yml` → `flyctl deploy --config infra/fly.toml`).
- **Cut a release:**
  ```bash
  # 1. from develop, create release branch + PR
  gh workflow run promote-release --ref develop -f version=0.2.0
  # 2. merge the PR to main on GitHub
  # 3. tag & release (pick one)
  git checkout main && git pull
  git tag v0.2.0 && git push origin v0.2.0          # → release.yml creates GitHub Release
  # or: gh workflow run release --ref main -f version=0.2.0
  ```
  Desktop `.dmg/.msi/.AppImage` attach automatically via `release-desktop.yml` (macOS `aarch64`+`x86_64`, Windows, Linux).
- **Hotfix:** `git checkout -b hotfix/x.y.z main` → PR to `main` + back-merge to `develop`.

See `CONTRIBUTING.md` for Conventional Commits and `DEVELOPMENT.md` for local dev.

## License

GPL-3.0-or-later — see `LICENSE`. Hosted API/billing terms apply separately.
