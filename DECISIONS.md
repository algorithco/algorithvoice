# Algorith Voice — Locked Build Decisions (v1.1, 2026-09-20; amends v1.0 2026-09-15)

Best-choice answers to the 7 open questions from the full-stack plan:

1. **Next.js: 16.3 LTS + React 19.2 + Tailwind v4** (NOT 14 — EOL Oct 2026). `next-themes` dark-default, BFF proxy, Vercel root `apps/web`.
2. **Infra: Docker Compose is authoritative for production and local development.** The production stack runs Postgres, Redis, migrations, API, worker, and web containers behind Cloudflare Tunnel. There is no provider-specific deploy workflow; deploy with `docker compose --env-file .env -f infra/docker-compose.yml up -d --build` on the Docker host.
3. **Local models: 6-model `sherpa-onnx` int8 catalog, `parakeet-tdt-0.6b-v3` default.** Desktop cloud currently means BYO Groq; the backend exposes a separate OpenRouter STT path. Whether the desktop should migrate to the metered backend remains an open product decision.
4. **Free tier: 60 min/mo on the metered backend path, unlimited local, 2 devices.** Pro has 10 devices. `past_due` is not entitled; missed webhooks are reconciled hourly. Direct BYO Groq traffic is not backend-metered.
5. **Licensing decision open.** Device limits are enforced online (2 free / 10 pro), but signed offline license JWTs are not implemented. Tauri targets NSIS/deb/AppImage; macOS is a separate native Swift app.
6. **Security:** the backend BYOK vault is not implemented, so `ENCRYPTION_KEK` is reserved and optional rather than presented as active encryption. Min OS: Windows 10 1809+ (WebView2), Ubuntu 22.04+. macOS 13+ applies to the Swift app only.
7. **Releases: `github.com/algorithco/algorithvoice`**, Windows/Linux bundles use Tauri's configured NSIS (`.exe`), AppImage, and Debian (`.deb`) targets, plus updater metadata/signatures where produced. macOS Swift ships separately. Custody: `TAURI_SIGNING_*` in GitHub Secrets, never in repo.

## Open remediation decisions

These choices are intentionally not guessed by the remediation pass:

8. **Email verification (H2):** recommended Resend, allow signup immediately, and require verification before OAuth account linking or billing. Postmark/SES are compatible alternatives; requiring verification before all access is stricter but adds signup friction.
9. **Offline licensing (H9):** recommended RS256 license JWTs signed with a secret-managed private key, with the public key embedded in desktop builds and a 7-day offline grace period. Until selected, online seat enforcement remains authoritative and the license endpoint is an explicit compatibility stub.
10. **Windows Authenticode (M-DESKTOP):** recommended Azure Trusted Signing. DigiCert/SSL.com are alternatives; remaining unsigned is supported only as a documented SmartScreen warning during the transition.
11. **Desktop cloud STT (C4):** recommended backend-metered STT as the default product path while retaining BYO Groq as an explicit advanced mode. The current release keeps BYO Groq behavior unchanged until this product choice is approved.
