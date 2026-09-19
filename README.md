<div align="center">
  <img src="assets/logo.svg" width="88" alt="Algorith Voice logo" />
  <h1>Algorith Voice</h1>
  <p><strong>Talk faster. Type never.</strong><br />Push-to-talk voice dictation for Windows &amp; Linux (Tauri + Rust).<br />macOS ships as a separate Swift app.<br />Hold a hotkey, speak, text appears in the focused app.</p>
  <p>
    <a href="https://github.com/algorithco/algorithvoice/actions/workflows/ci.yml"><img src="https://github.com/algorithco/algorithvoice/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/algorithco/algorithvoice/releases"><img src="https://img.shields.io/github/v/release/algorithco/algorithvoice?style=flat&label=release" alt="Release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/algorithco/algorithvoice?style=flat" alt="License: GPL-3.0-or-later" /></a>
    <img src="https://img.shields.io/badge/platform-Windows_%7C_Linux-black?style=flat" alt="Windows, Linux (Tauri); macOS via Swift" />
  </p>
</div>

---

### Why

- **Push-to-talk, everywhere** — `Ctrl+Space` in any app (terminal, IDE, browser). Release → text lands at the cursor in <1s.
- **Local-first privacy** — offline mode: audio never leaves the device, no account, no telemetry by default.
- **Cloud when you want it** — Voxtral Realtime primary + Parakeet fallback. 60 free cloud min/mo, unlimited local.

### How it works

```text
Desktop (Tauri 2 + Rust, Windows & Linux)  <── WS / REST ──>  Backend (Fastify 5)  <── BFF ──>  Web (Next.js 16)
  sherpa-onnx, offline-first                                  Voxtral + Parakeet                  marketing + dashboard
macOS: separate native Swift app in apps/desktop-swift (not Tauri).
```

Monochrome by design (`#000` / `#FFF`), offline-first, privacy-respecting.

### Local mode — 6 on-device models

Offline transcription via `sherpa-onnx` (no Python). All models are `int8` and downloaded on demand from `huggingface.co/algorithco/*` over HTTPS with SHA-256 verification; audio never leaves the device.

| Model | Files | Size | Languages | License |
| --- | --- | --- | --- | --- |
| **parakeet-tdt-0.6b-v3** (default, 25 EU langs) | `encoder/decoder/joiner.int8.onnx` + `tokens.txt` | ~670 MB | bg, hr, cs, da, nl, en, et, fi, fr, de, el, hu, it, lv, lt, mt, pl, pt, ro, sk, sl, es, sv, ru, uk | CC-BY-4.0 |
| **whisper-small** | `small-encoder/decoder.int8.onnx` + `tokens` | ~375 MB | 99 langs (whisper family) | Apache-2.0 |
| **whisper-large-v3-turbo** | `turbo-*` | ~1.0 GB | 99 langs | MIT |
| **whisper-large-v3** | `large-v3-*` | ~1.7 GB | 99 langs | Apache-2.0 |
| **qwen3-asr-1.7b** | `conv_frontend + encoder/decoder` + `tokenizer/*` (3) | ~2.4 GB | en, zh, ja, ko, vi | Apache-2.0 |
| **distil-large-v3.5** | `distil-*` | ~983 MB | en | MIT |

Manage in **Settings → Transcription mode → Local (offline)**: search, language filter, hardware check (RAM/VRAM/disk), download progress (bytes/s, ETA), verify, delete, and `Active` selection. `Settings → System` + `ModelManager` shows `sherpa-onnx-cpu` runtime, compatibility (`minRamGb`/`minVramGb` gates), and load progress (`resolving-files`→`creating-engine`→`ready`).

### Quickstart (native dev)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

### Full stack in Docker

```bash
cp .env.example .env  # set real JWT_ACCESS_SECRET / JWT_REFRESH_PEPPER / ENCRYPTION_KEK
docker compose -f infra/docker-compose.yml up -d --build
```

Migrations run automatically (`migrate` one-shot service); backend gates on
it. Web http://127.0.0.1:3000 · API http://127.0.0.1:3001/health —
use `127.0.0.1` (not `localhost`) so cookies/CORS line up with the
container `APP_URL` (production validation rejects `localhost`).

| Service | URL |
| ------- | --- |
| Web | http://localhost:3000 |
| Backend health | http://localhost:3001/health |
| Desktop | `pnpm --filter @algorith-voice/desktop tauri:dev` (needs Rust) |

### Monorepo

```text
apps/desktop-tauri    Tauri 2 desktop app — Windows & Linux (Rust + React)
apps/desktop-swift    Native macOS app (Swift/SwiftUI, separate from Tauri)
apps/web              Next.js 16 marketing + dashboard
apps/backend          Fastify 5 API + WebSocket
packages/shared-types Zod contracts (single source of truth)
packages/ui           Monochrome React components
infra/                compose stack (postgres/redis/migrate/backend/worker/web) + Prisma + Fly
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
