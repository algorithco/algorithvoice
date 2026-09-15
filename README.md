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

## License

GPL-3.0-or-later — see `LICENSE`. Hosted API/billing terms apply separately.
