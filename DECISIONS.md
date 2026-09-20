# Algorith Voice — Locked Build Decisions (v1.1, 2026-09-20; amends v1.0 2026-09-15)

Best-choice answers to the 7 open questions from the full-stack plan:

1. **Next.js: 16.3 LTS + React 19.2 + Tailwind v4** (NOT 14 — EOL Oct 2026). `next-themes` dark-default, BFF proxy, Vercel root `apps/web`.
2. **Infra: Fly.io primary for API+WS+worker** (single region `fra` EU, min-1-warm, Upstash Fixed 1GB or self-host Redis). **Vercel for web.** `docker-compose` local mirrors prod. (v1.0 mentioned a `railway.toml` fallback — no such file exists in the repo; removed.)
3. **Local models: 6-model `sherpa-onnx` int8 catalog, `parakeet-tdt-0.6b-v3` (~670MB, 25 EU langs) default** (see README “Local mode” table for sizes/licenses). Supersedes the v1.0 `base` (142MB) default. Cloud primary `voxtral-mini-transcribe-realtime-2602` ($0.006/min), fallback OpenRouter `nvidia/parakeet-tdt-0.6b-v3` ($0.0015/min).
4. **Free tier: 60 min/mo cloud, unlimited local, 2 devices, 1 concurrent stream.** BYOK allowed on free (bypasses metering, still WS rate-limited). Paid: unlimited cloud + 10 devices + priority.
5. **License: 3 seats/user, 7d offline grace, stable-only updater channel.** Desktop split: Tauri + Rust is Windows & Linux only (`apps/desktop-tauri`, targets `nsis/deb/appimage`, no `macOSPrivateApi`/`.icns`); macOS is a separate native Swift app (`apps/desktop-swift`).
6. **Security: env-held 32B `ENCRYPTION_KEK` for beta → Cloud KMS at Phase 5.** Min OS: Windows 10 1809+ (WebView2), Ubuntu 22.04+. macOS 13+ applies to the Swift app only.
7. **Releases: `github.com/algorithco/algorithvoice`**, assets `algorithvoice_{version}_{target}_{arch}.{msi,AppImage,deb}` + `latest.json` + `.sig` (Tauri Windows/Linux; macOS Swift ships separately). Custody: `TAURI_SIGNING_*` in GitHub Secrets, never in repo.
