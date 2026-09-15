# Algorith Voice — Locked Build Decisions (v1.0, 2026-09-15)

Best-choice answers to the 7 open questions from the full-stack plan:

1. **Next.js: 16.3 LTS + React 19.2 + Tailwind v4** (NOT 14 — EOL Oct 2026). `next-themes` dark-default, BFF proxy, Vercel root `apps/web`.
2. **Infra: Fly.io primary for API+WS+worker** (single region `fra` EU, min-1-warm, Upstash Fixed 1GB or self-host Redis). **Vercel for web.** `railway.toml` kept as fallback. `docker-compose` local mirrors prod.
3. **Local model: multilingual `base` (142MB) default**, `base.en` option for EN-only speed, `small` opt-in download, Q5_1 quant evaluated post-MVP. Cloud primary `voxtral-mini-transcribe-realtime-2602` ($0.006/min), fallback OpenRouter `nvidia/parakeet-tdt-0.6b-v3` ($0.0015/min).
4. **Free tier: 60 min/mo cloud, unlimited local, 2 devices, 1 concurrent stream.** BYOK allowed on free (bypasses metering, still WS rate-limited). Paid: unlimited cloud + 10 devices + priority.
5. **License: 3 seats/user, 7d offline grace, stable-only updater channel.** macOS split-arch (`aarch64` + `x86_64` separate, no universal for MVP speed).
6. **Security: env-held 32B `ENCRYPTION_KEK` for beta → Cloud KMS at Phase 5.** Min OS: macOS 13+, Windows 10 1809+ (WebView2), Ubuntu 22.04+.
7. **Releases: `github.com/algorith-voice/algorith-voice`**, assets `algorith-voice_{version}_{target}_{arch}.{dmg,msi,AppImage,deb}` + `latest.json` + `.sig`. Custody: `TAURI_SIGNING_*` + Apple certs in GitHub Secrets, never in repo.
