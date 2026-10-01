# Security and privacy claim map

| Claim | Enforcement |
| --- | --- |
| Access tokens expire after 15 minutes and refresh tokens rotate | `apps/backend/src/app.ts`, `modules/auth/refresh-rotation.ts`; H1 integration tests |
| Revoked access tokens are rejected | `apps/backend/src/plugins/jwt.ts`; H10 integration test |
| OAuth web login is browser-bound and does not put tokens in URLs | `modules/auth/auth.routes.ts`, web OAuth session BFF; H3 tests |
| Passwords use Argon2id and expensive work is concurrency-limited | `modules/auth/auth.routes.ts`, `login-protection.ts` |
| Device seats cannot race above the plan limit | `modules/devices/license.routes.ts`, migration 8; H9 concurrency tests |
| Local transcription keeps audio on device | Tauri local ASR worker and local-mode tests |
| Desktop cloud audio goes to Groq with a key from the OS keyring | `apps/desktop-tauri/src-tauri/src/push_to_talk.rs` |
| Backend cloud STT is quota checked and metered | STT routes/worker and C2/C3 integration tests. The gate is read-before-write, so a concurrent free-tier burst may overshoot by one request; metering remains idempotent. |
| OAuth audit identifiers are keyed and monthly rotated | `modules/oauth2/oauth2.audit.ts`; M-BACKEND-5 unit test |
| Billing webhooks are signature checked and idempotent | billing route, Stripe event worker, H5/Stripe tests |

Claims not yet made: offline-verifiable license JWTs, an encrypted backend BYOK vault, WebSocket STT streaming, and cross-device preference/history sync.
