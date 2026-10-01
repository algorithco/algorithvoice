# Security Policy

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/algorithco/algorithvoice/security/advisories/new). Do not file public issues for vulnerabilities.

## Posture (MVP)

- Secrets via env only (`.env.example`, never committed). Provider + Stripe keys server-side only.
- Passwords `argon2id (m=64MiB,t=3,p=4)`. Access JWTs use HS256 for 15 minutes plus rotating opaque refresh tokens; reuse detection revokes the family.
- Zod validates shared public contracts and the security-sensitive routes covered by integration tests; older admin routes also map direct Zod failures to HTTP 400.
- The desktop Groq key is stored in the operating-system keyring. The unused database `ProviderKey` model is not presented as an implemented BYOK vault.
- Device seats are enforced server-side. Offline-verifiable signed license tokens are not implemented yet; the current license response is not a trust boundary.
- Tauri capabilities deny-by-default + CSP. Cookies `HttpOnly;Secure;SameSite`.

### OAuth compatibility note

Shipped desktop builds still use a legacy GitHub OAuth deep-link that can carry a short-lived access token in the callback URL. The backend keeps this path enabled by default through `LEGACY_DESKTOP_OAUTH_TOKEN_IN_URL=true`, logs each use as deprecated, and supports disabling it after all released desktop versions have migrated to the OAuth2 PKCE flow. New web and desktop flows use one-time handoff codes or PKCE and never place tokens in URLs.
