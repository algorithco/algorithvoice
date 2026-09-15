# MASTER BUILD PROMPT — Algorith Voice (Full Platform)

> Copy everything below into your AI coding agent (Claude Code, Cursor, etc.). This describes a complete, production-grade platform: a backend, a desktop app for macOS/Windows/Linux, and a marketing website. Build it fully — this is not a toy project.

---

## ROLE

You are a senior full-stack + systems architect. Build **Algorith Voice**: a platform where users install a desktop app on macOS, Windows, or Linux, hold a hotkey, speak, and get their speech instantly and accurately typed into whatever app is focused (terminal, IDE, browser, AI chat). The platform includes a central backend that manages accounts, licensing, usage, billing, and cloud transcription — plus a marketing website. Treat this as a real company's core product, not a demo.

---

## SYSTEM OVERVIEW (3 MAJOR COMPONENTS)

```
┌─────────────────────────┐      ┌──────────────────────┐      ┌─────────────────────────┐
│   DESKTOP APP            │      │      BACKEND          │      │      WEBSITE             │
│  (macOS / Windows /      │◄────►│  (API, Auth, Billing,  │◄────►│  (Marketing + Account    │
│   Linux — Tauri/Rust)    │      │   STT proxy, Sync)     │      │   Dashboard — Next.js)   │
└─────────────────────────┘      └──────────────────────┘      └─────────────────────────┘
        │                                    │
        ▼                                    ▼
  Local Whisper.cpp                   Cloud STT providers
  (offline mode)                      (OpenRouter / Parakeet / Voxtral)
                                       Postgres (users, usage, licenses)
                                       Object storage (optional audio logs, opt-in only)
```

---

## DESIGN SYSTEM (STRICT — APPLIES TO DESKTOP APP, WEBSITE, AND DASHBOARD)

- **Colors:** Pure black (#000000) and pure white (#FFFFFF) only, plus grayscale (#0A0A0A, #1A1A1A, #E5E5E5, #F5F5F5) for depth. No accent colors, no gradients, no colored icons anywhere — app, tray icon, website, emails, admin panel.
- **Typography:** One clean sans-serif (Inter or system font stack). Confident large type on the website, dense/minimal in-app.
- **Aesthetic:** Minimal, monochrome, high-contrast, "engineered" feel (Raycast/Linear/Arc-inspired). Sharp or barely-rounded corners (2-6px). No clutter, generous whitespace.
- **Dark mode default**, light mode toggle — both strictly black/white/gray.
- **Motion:** Fast, subtle transitions only (150-200ms), no bounce/playful animation.

No exceptions to black/white/grayscale anywhere in the product, including charts, diagrams, and marketing graphics.

---

## COMPONENT 1 — BACKEND (the platform core)

### Responsibilities
- User accounts and authentication (email/password + OAuth via Google/GitHub)
- Desktop app licensing: issue and validate device licenses/tokens per user
- Subscription and billing (Stripe): free tier with usage cap, paid tier unlimited
- Usage metering: track transcription minutes/requests per user per billing period
- Cloud STT proxy: desktop app calls backend, backend calls the actual STT provider (NVIDIA Parakeet / Mistral Voxtral / Whisper API via OpenRouter) — keeps provider API keys server-side, never in the client
- BYOK support: users may alternatively store their own provider API key encrypted in their account and bypass backend metering
- Optional encrypted cross-device settings sync (hotkey prefs, dictionary, history) — must be opt-in, off by default
- Admin dashboard (internal-only) to view users, usage, revenue, and system health
- Rate limiting, abuse prevention, and audit logging

### Tech stack (required)
- **Language/framework:** Node.js + TypeScript, using Fastify (preferred over Express for performance/type-safety)
- **Database:** PostgreSQL, accessed via Prisma ORM
- **Auth:** JWT access + refresh tokens; OAuth via Google and GitHub
- **Billing:** Stripe (subscriptions, webhooks for renewal/cancellation events)
- **Queue/background jobs:** BullMQ + Redis (for usage aggregation, email sending, webhook retries)
- **Real-time (optional but preferred for low-latency streaming STT):** WebSocket endpoint for streaming audio chunks from desktop app to backend to STT provider and back
- **Object storage:** S3-compatible (e.g. Cloudflare R2) — only used if a user opts in to storing audio/history in the cloud; local mode never touches this
- **Infra:** Dockerized services, docker-compose for local dev, deployable to Fly.io or Railway
- **API design:** REST for CRUD (auth, billing, settings), WebSocket for streaming transcription
- **Testing:** Vitest for unit tests, integration tests against a test Postgres instance

### Core API surface (build these endpoints)
```
POST   /auth/signup
POST   /auth/login
POST   /auth/oauth/:provider
POST   /auth/refresh
GET    /me
PATCH  /me/settings

POST   /billing/create-checkout-session
POST   /billing/webhook          (Stripe events)
GET    /billing/subscription

POST   /license/activate         (desktop app activates a device)
POST   /license/validate

WS     /stt/stream                (streaming audio in, transcribed text out)
POST   /stt/transcribe            (non-streaming fallback)

GET    /usage/summary

GET    /admin/users               (admin-only, protected)
GET    /admin/metrics
```

### Security requirements
- All provider API keys and Stripe secrets in server-side env vars only, never shipped to client
- Passwords hashed with argon2
- Rate limit auth and STT endpoints per user/IP
- Input validation via Zod on every endpoint

---

## COMPONENT 2 — DESKTOP APP (macOS, Windows, Linux)

### Tech stack (required)
- **Framework:** Tauri 2.0 (Rust backend + web frontend). Do NOT use Electron.
- **Frontend:** React + TypeScript + Tailwind CSS
- **Audio capture:** `cpal` (Rust), 16kHz mono PCM
- **Voice Activity Detection:** Silero VAD via ONNX runtime in Rust
- **Speech-to-text (dual mode, user-selectable):**
  - **Local:** whisper.cpp bundled (base/small multilingual model default; larger models downloadable)
  - **Cloud:** streams audio to the backend's `/stt/stream` WebSocket, which proxies to the provider — no direct client-to-provider calls unless BYOK is set
- **Global hotkey:** Tauri global-shortcut plugin, configurable, default push-to-talk
- **Text injection:** Rust `enigo` — clipboard + simulated paste into the focused app; handle macOS Accessibility permission, Windows UAC edge cases, and Linux X11/Wayland differences explicitly (Wayland requires `ydotool`; document the extra setup step for Wayland users)
- **Local storage:** SQLite (`rusqlite`) for offline history/settings; syncs to backend only if user opts in
- **Auth:** device-linked login (paste a login code from the website, or OAuth flow that opens a browser and deep-links back into the app)
- **Tray/menu bar:** black/white icon, 3 states (idle/recording/processing)
- **Auto-update:** Tauri's built-in updater, pointed at signed releases from GitHub Releases

### Platform-specific build targets
- macOS: `.dmg`, notarization-ready (document the notarization steps even if not fully automated in MVP)
- Windows: `.msi` via Tauri bundler
- Linux: `.AppImage` and `.deb`

---

## COMPONENT 3 — WEBSITE (marketing + account dashboard)

### Tech stack (required)
- **Framework:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Auth:** shares the backend's auth (calls the same `/auth` endpoints)
- **Pages:**
  - Landing page: one-sentence value prop, how-it-works (3 steps), OS download buttons, pricing, privacy note ("local mode = audio never leaves your device")
  - Pricing page: free tier vs paid tier, Stripe checkout integration
  - Account dashboard (post-login): usage stats, billing management (Stripe customer portal), device list, API key (if BYOK), transcription history (if cloud sync opted in)
  - Docs page: setup guide per OS, troubleshooting (mic permissions, accessibility permissions)
  - Privacy Policy / Terms
- **Deployment:** Vercel-ready

---

## MONOREPO STRUCTURE

```
algorith-voice/
├── apps/
│   ├── desktop/          # Tauri app (Rust + React)
│   ├── web/              # Next.js marketing + dashboard
│   └── backend/          # Fastify API + WebSocket server
├── packages/
│   ├── shared-types/     # Shared TypeScript types (API contracts)
│   └── ui/               # Shared black/white React components (buttons, inputs) used by web + desktop frontend
├── infra/
│   ├── docker-compose.yml
│   └── prisma/           # Schema + migrations
├── .github/
│   └── workflows/        # CI: lint/test/build per package; release builds per OS; backend deploy
├── README.md
├── LICENSE
├── CONTRIBUTING.md
└── PRIVACY.md
```

- Use `pnpm` workspaces to tie everything together
- Shared types package ensures desktop app, backend, and website agree on API contracts — no drift

---

## MVP SCOPE — BUILD IN THIS ORDER

**Phase 0 — Foundation**
1. Scaffold monorepo (pnpm workspaces), init git, set up `docker-compose` with Postgres + Redis
2. Backend: Prisma schema (User, Device, Subscription, UsageRecord), auth endpoints, JWT middleware
3. Backend: Stripe integration (checkout + webhook handling) on a test/sandbox account

**Phase 1 — Desktop app shell**
4. Tauri app shell with black/white theme, tray icon states, settings window (no real functionality yet)
5. Login flow: device pairs with an Algorith Voice account via the backend's auth

**Phase 2 — Core voice pipeline**
6. Audio capture + hotkey trigger → placeholder "transcribing..." UI state
7. Local whisper.cpp transcription, fully offline, end-to-end
8. Cloud transcription via backend WebSocket proxy (streaming), with usage metering hooked up
9. Clipboard + paste text injection into the focused app (macOS first, then Windows, then Linux)

**Phase 3 — Product completeness**
10. Local transcription history (SQLite) + optional cloud sync toggle
11. Onboarding + permissions flow (mic, accessibility) with clear black/white illustrated steps
12. BYOK settings (user's own provider API key, encrypted at rest)

**Phase 4 — Website + billing**
13. Next.js marketing site matching the design system, with working OS-specific download buttons
14. Account dashboard: usage stats, Stripe billing portal link, device management

**Phase 5 — Ops**
15. GitHub Actions: CI (lint/test/build all packages on PR), release workflow (build signed-ready binaries per OS on tag push), backend deploy workflow
16. Write README.md (architecture diagram, setup instructions), CONTRIBUTING.md, PRIVACY.md, LICENSE (MIT unless told otherwise)

After each numbered step, stop and summarize what was built, what decisions were made, and what's next — do not silently continue past a phase boundary without a checkpoint.

**Explicitly deferred to Phase 2 of the roadmap (do not build now):** team/org accounts, custom vocabulary training, real-time multi-language auto-detect, mobile companion app, browser extension.

---

## NON-FUNCTIONAL REQUIREMENTS

- End-to-end latency target: under 1 second from key-release to text appearing, in cloud streaming mode
- Local mode must work fully offline with zero backend dependency
- No telemetry without explicit opt-in — documented in `PRIVACY.md`
- All secrets via environment variables (`.env.example` provided, never committed)
- Code must be clean, typed, commented where non-obvious, structured for outside contributors
- Tests: Rust unit tests (audio/injection), Vitest tests (backend endpoints), React component tests (settings/dashboard UI)
- Backend must handle provider API failures gracefully with fallback/retry and clear user-facing error states

---

## OUTPUT EXPECTATIONS

- Production-quality code throughout — proper error handling, no hardcoded secrets, no placeholder logic left unmarked
- Every screen across desktop app, website, and dashboard strictly follows the black/white design system
- Ask before making any architectural decision not covered in this prompt
- Treat this as the actual foundation of a company's product, not a prototype to be thrown away
