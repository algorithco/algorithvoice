<div align="center">
  <img src="assets/logo.svg" width="88" alt="Algorith Voice logo" />
  <h1>Algorith Voice</h1>
  <p><strong>Talk faster. Type never.</strong><br />Push-to-talk voice dictation for macOS, Windows &amp; Linux.<br />Hold a hotkey, speak, text appears in the focused app.</p>
  <p>
    <a href="https://github.com/algorithco/algorithvoice/actions/workflows/ci.yml"><img src="https://github.com/algorithco/algorithvoice/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/algorithco/algorithvoice/releases"><img src="https://img.shields.io/github/v/release/algorithco/algorithvoice?style=flat&label=release" alt="Release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/algorithco/algorithvoice?style=flat" alt="License: GPL-3.0-or-later" /></a>
    <img src="https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-black?style=flat" alt="macOS, Windows, Linux" />
  </p>
</div>

---

### Why

- **Push-to-talk, everywhere** — `Ctrl+Space` in any app (terminal, IDE, browser). Release → text lands at the cursor in <1s.
- **Local-first privacy** — offline mode: audio never leaves the device, no account, no telemetry by default.
- **Cloud when you want it** — Voxtral Realtime primary + Parakeet fallback. 60 free cloud min/mo, unlimited local.

### How it works

```text
Desktop (Tauri 2 + Rust)  <── WS / REST ──>  Backend (Fastify 5)  <── BFF ──>  Web (Next.js 16)
  whisper.cpp, offline-first                   Voxtral + Parakeet                  marketing + dashboard
```

Monochrome by design (`#000` / `#FFF`), offline-first, privacy-respecting.

### Quickstart

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

| Service | URL |
| ------- | --- |
| Web | http://localhost:3000 |
| Backend health | http://localhost:3001/health |
| Desktop | `pnpm --filter @algorith-voice/desktop tauri:dev` (needs Rust) |

### Monorepo

```text
apps/desktop          Tauri 2 desktop app (Rust + React)
apps/web              Next.js 16 marketing + dashboard
apps/backend          Fastify 5 API + WebSocket
packages/shared-types Zod contracts (single source of truth)
packages/ui           Monochrome React components
infra/                docker-compose + Prisma
.github/workflows/    CI, releases, desktop builds
```

### Docs

- [`DECISIONS.md`](DECISIONS.md) — locked stack & product choices
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, commits, branching
- [`PRIVACY.md`](PRIVACY.md) · [`SECURITY.md`](SECURITY.md)

> Releases: `feature/*` → PR to `develop` → `release/vX.Y.Z` → PR to `main` → tag `vX.Y.Z`. Never push to `main` directly. Details in [`CONTRIBUTING.md`](CONTRIBUTING.md).

### License

GPL-3.0-or-later — see [`LICENSE`](LICENSE). Hosted API/billing terms apply separately.

<div align="center"><sub>Built by <a href="https://github.com/algorithco">Algorithco</a> · © 2026 Algorith Voice</sub></div>
