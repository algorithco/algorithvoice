# Security Policy

Report vulnerabilities privately to `security@algorithvoice.com`. Do not file public issues for vulns. Expect ack within 72h.

## Posture (MVP)

- Secrets via env only (`.env.example`, never committed). Provider + Stripe keys server-side only.
- Passwords `argon2id (m=64MiB,t=3,p=4)`. JWT RS256 15m + rotating opaque refresh, reuse-detection revokes family.
- Zod validation on every endpoint + Tauri command. Rate limits on auth/STT.
- BYOK envelope-encrypted (AES-256-GCM, KEK rotation via `kek_version`).
- License JWT offline-verifiable (embedded public key) + 7d grace.
- Tauri capabilities deny-by-default + CSP. Cookies `HttpOnly;Secure;SameSite`.
