# Algorith Voice remediation report

This report records the remediation pass against `algorithvoice-fix-prompt.md`.
The completed remediation is collected on the review branch without any reset,
force operation, or unrelated cleanup.

## Finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| T0 integration harness | fixed | `apps/backend/test/helpers/app.ts`, smoke test, isolated PostgreSQL/Redis setup |
| C1 token boundary | fixed | typed subject checks, derived OAuth-state key/audience/type, admin reuse of authentication, C1 integration tests |
| C3 async STT controls | fixed | shared quota/model policy, owner-bound jobs/results, atomic per-user Redis admission, local or R2 storage with stale cleanup, safe failures, C3 tests |
| C2 usage/metering | fixed | idempotent usage migration/worker, AI request logging, DB model selection, usage endpoint tests |
| H1 refresh rotation | fixed | atomic family rotation, reuse grace, single-flight web refresh, cookie preservation, H1 tests |
| H8 environment/deployment | fixed | validated production rules, internally consistent bootable dev template, safe API URL module, Compose/CI hardening, env tests |
| H10 logout/revocation | fixed | JTI on password tokens, family revocation, desktop logout path, H10 tests |
| H6 duration forgery | fixed | RIFF chunk parsing, lower-bound charging and clamping, duration tests |
| H2 OAuth account takeover | safe interim; decision open | password/account auto-link refusal, verified OAuth signup, GitHub verified-email-only trust, email verification migration and H2 tests |
| H3 GitHub OAuth web flow | fixed with legacy compatibility flag | browser nonce, one-time Redis handoff, exchange endpoint, content/origin checks, timeouts, H3 tests |
| H4 web BFF token exposure | fixed | login/signup BFFs return user-only bodies and do not forward backend cookies; H4 tests |
| H5 billing correctness | fixed | duplicate-checkout guard, webhook exemption/deduplication, failed-redelivery persistence, invoice-shape support, current-state reconciliation for out-of-order events, H5 tests |
| H7 worker retries | fixed | retry-safe audio lifetime, final-attempt cleanup, result-persistence retries, BullMQ rate limiting, unrecoverable 4xx handling, sanitized failures, worker tests |
| H9 seats/device type | fixed; license decision open | advisory-lock transaction, partial unique fingerprint index, strict device parsing, full device visibility after seat downgrades, H9 tests |
| H11 distributed rate limiting | fixed | Redis store, bounded proxy trust, account delay and Argon2 semaphore, H11 tests |
| M-BACKEND | fixed | blocking, Zod error mapping, scopes, keyed audit hashes, CORS/docs/cluster/metering/memory fixes and unit tests |
| M-DESKTOP | fixed except signing-provider decision | per-window ACL, clipboard/image restore, paste preferences, safe errors/NVML paths, dev CSP overlay, OAuth session-commit race fix, entitlement IPC refresh and floating-pill capability fixes, and Rust tests |
| M-WEB | fixed | security headers, restricted admin proxy, DAL control flow, release cache/error redaction and tests |
| M-CI / supply chain | fixed | full action-SHA pins with API-verified tag annotations, release/version gates, protected publishing, Compose gate inputs, patched transitive overrides, Dependabot, version check, de-duplicated tests |
| T-TESTS | fixed | auth lifecycle, OAuth2/PKCE, GitHub OAuth, STT sync/async, billing, usage, devices, and all admin-route authorization coverage; compiled tests excluded |
| D-DOCS | fixed with open decisions recorded | truthful `README.md`, `SECURITY.md`, `PRIVACY.md`, `DECISIONS.md`, and `docs/CLAIMS.md` |
| O observability | fixed | structured events for auth failures/reuse, quota denials, webhook ingress/processing failures, queue depth, Redis memory, provider errors, and credential-safe logging that strips Redis credentials, request query strings, and upstream provider bodies |

## Files, tests, and commits

| ID | Primary implementation files | Regression evidence | Commit(s) |
| --- | --- | --- | --- |
| T0 | `apps/backend/test/helpers/app.ts`, `vitest.config.ts`, CI integration job | `smoke.integration.test.ts` | —* |
| C1 | `plugins/jwt.ts`, `auth/oauth-state.ts`, admin routes, Prisma strict-undefined setting | `c1-auth-boundary.integration.test.ts`, OAuth audit unit test | —* |
| C3 | STT routes/policy/models/slots/storage and worker processor | `c3-async-stt.integration.test.ts`, storage/worker tests | —* |
| C2 | usage metering helper/worker, model config selection, migration 3 | `c2-metering.integration.test.ts` | —* |
| H1 | `auth/refresh-rotation.ts`, auth/OAuth2 routes, web middleware/refresh BFF | H1 integration and web refresh tests | —* |
| H8 | backend env schema, `.env.example`, web API URL module, Compose/Fly/CI | env and web API URL tests; Compose validation | —* |
| H10 | JWT mint/auth paths and desktop logout/revocation | H10 integration and desktop auth tests | —* |
| H6 | `stt.utils.ts` RIFF/container duration calculation | `stt.utils.test.ts` | —* |
| H2 | auth callback, migration 4 | `h2-oauth-linking.integration.test.ts` | —* |
| H3 | auth handoff/state, web OAuth BFF, desktop URL restrictions | H3 integration/BFF/handoff tests | —* |
| H4 | login/signup BFF routes | login/signup route tests | —* |
| H5 | billing routes, Stripe worker, migration 5 | `h5-billing.integration.test.ts`, Stripe unit tests | —* |
| H7 | `stt-worker-processor.ts`, worker wiring | worker retry lifecycle tests | —* |
| H9 | license routes/device parser, migration 8 | H9 concurrency/ownership/downgrade tests | —* |
| H11 | Redis rate limit setup and `login-protection.ts` | H11 two-instance/spoof/delay tests | —* |
| M-BACKEND | admin/auth/OAuth/server/queue/CORS/readiness code; migrations 6–7 | account/scope/admin, CORS, cluster, queue-option, audit tests | —* |
| M-DESKTOP | capabilities, Rust manifest/clipboard/paste/NVML/CSP/session code | Rust suite and desktop Vitest suite, including approved-session persistence during auth-view unmount | —* |
| M-WEB | Next headers, admin proxy, DAL, releases route | header/admin/release route tests | —* |
| M-CI | `.github/**`, root overrides, backend build/test configs, version script | SHA validator, audit, version and test-discovery checks | —* |
| D-DOCS | `README.md`, `SECURITY.md`, `PRIVACY.md`, `DECISIONS.md`, `docs/CLAIMS.md` | claim-to-code map and build checks | —* |
| O | structured event sites and `config/redis-url.ts` | Redis redaction and webhook-failure tests | —* |

\* The findings are delivered together on the review branch because they form one
interdependent hardening pass. No reset, force operation, or unrelated cleanup
was performed.

## Deviations

- The implementation and verification artifacts are delivered as one reviewable
  branch because the security, schema, client, infrastructure, and test changes
  are interdependent.
- C3 uses private R2 object storage on Fly and a shared capped local volume in
  Compose, rather than storing audio in a second Redis instance. Redis contains
  only atomic admission slots and queue metadata.
- H1 uses the allowed soft `409 retry` response during the ten-second refresh
  reuse grace period instead of persisting plaintext successor refresh tokens.
- `@aws-sdk/client-s3` is retained because C3 now uses it. The unused S3
  presigner and Fastify OAuth dependencies are not retained.

## Findings that were wrong or already fixed

None of the listed verified/verify-first findings was dismissed as incorrect.
Each was reproduced by a failing test, a failing verification command, or a
precise code/configuration trace before remediation. During the final audit,
additional real gaps were found and fixed: inconsistent development database
credentials, missing Compose CI inputs, a worker Redis-credential log leak,
missing worker-side webhook failure events, vulnerable transitive packages, and
backend `dist` test duplication. The final completion audit also removed
forbidden Prisma `as never` escapes and closed two observability leaks: OAuth
query parameters in completion logs and retained upstream STT response bodies.

## Open decisions

The prompt explicitly requires user input for these choices; the safe interim
behavior remains active until approved:

1. Email provider and verification timing (recommended: Resend; verify before OAuth linking/billing).
2. Signed offline licensing (recommended: RS256 license JWT, secret-managed private key, 7-day grace).
3. Windows Authenticode provider (recommended: Azure Trusted Signing).
4. Desktop cloud STT product path (recommended: backend-metered default with BYO Groq as an advanced mode).

Options and trade-offs are recorded in `DECISIONS.md`.

## Rollout notes

- Deploy Prisma migrations before API/worker code. Migration 8 requires a preflight check for duplicate non-null `(userId, fingerprint)` values.
- `LEGACY_DESKTOP_OAUTH_TOKEN_IN_URL=true` remains the compatibility default for shipped desktop builds; new clients use OAuth2 PKCE or one-time handoff codes. Disable it after migration of released clients.
- Production requires non-loopback `APP_URL`/`API_URL`, strong JWT/refresh values, `AUDIT_HASH_KEY`, and Stripe price IDs when Stripe is enabled. `ENCRYPTION_KEK` is reserved for optional encrypted-secret features and is validated when configured.
- `READINESS_TOKEN` is optional; unauthenticated readiness returns only `{ok}`.
- Async STT admission uses atomic Redis slots (three active jobs per user, one-hour reservation TTL) and releases them on every terminal path.
- Set `STT_STORAGE_BACKEND=local` only when API and worker share the same volume, as they do in Compose. Fly uses `STT_STORAGE_BACKEND=r2` and requires `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` secrets.
- Existing local containers must be recreated after setting `POSTGRES_PASSWORD`
  and `REDIS_PASSWORD` so the loopback-only port bindings and Redis
  authentication in the current Compose file take effect. The committed
  `.env.example` development URLs now use the same passwords as those services.
- Root pnpm overrides pin `fast-uri` 3.x/4.x and `ip-address` to the first
  patched releases for the September 2026 advisories. Remove each override only
  after its Fastify dependency graph resolves to an equal or newer safe version.
- Configure the `desktop-public-release` GitHub environment with required
  reviewers and a fine-grained, expiring `PUBLIC_REPO_PAT` before publishing.

## Risks and follow-ups

- The four product decisions above remain intentionally unimplemented beyond
  their safe interim behavior.
- RustSec currently reports seven accepted upstream warnings already enumerated
  in CI (`RUSTSEC-2024-0370`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0075`,
  `RUSTSEC-2025-0080`, `RUSTSEC-2025-0100`, `RUSTSEC-2025-0098`, and
  `RUSTSEC-2024-0429`). The fail-closed audit passes only when there are no
  warnings beyond that explicit list; continue tracking Tauri's dependency
  chain so these exceptions can be removed.
- Next.js reports that the `middleware` filename convention is deprecated in
  favor of `proxy`; it still builds and runs on the pinned Next version. The
  desktop Vite build also reports a large main chunk. Neither warning changes a
  requested security invariant, but both are reasonable follow-up maintenance.

## Verification

- `pnpm exec biome check .` — 320 files clean.
- `pnpm -r run typecheck` — all workspace projects pass, including backend
  integration tests through `tsconfig.test.json`.
- PowerShell `$env:NODE_OPTIONS='--max-old-space-size=4096'; pnpm -r run test`
  — shared 15, web 20, desktop 96, backend 163 distinct tests passed (294 total)
  in the completion audit. The subsequent live-login regression fix raises the
  desktop suite to 98 passing tests after the OAuth persistence and entitlement
  refresh regressions (296 workspace tests total).
- Backend `vitest list --filesOnly` — 30 source/integration files and no
  `dist` files; TypeScript `--listEmittedFiles` emits no test JavaScript.
- `cargo fmt --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml --check` — pass.
- `cargo clippy --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — pass.
- PowerShell `$env:CARGO_BUILD_JOBS='1'; cargo test --manifest-path
  apps/desktop-tauri/src-tauri/Cargo.toml --all-targets --all-features` — 117
  tests pass.
- `pnpm -r run build` — pass.
- `docker build -f apps/backend/Dockerfile -t algorith-voice-backend:remediation .` — pass.
- `docker build -f apps/web/Dockerfile -t algorith-voice-web:remediation .` — pass.
- Compose configuration with CI-only password inputs and automatic `.env`
  loading disabled — pass.
- `pnpm check:versions` — all workspace versions `0.5.20`.
- `pnpm audit --prod` — no known vulnerabilities.
- `cargo audit --deny warnings` with only the seven CI-documented upstream
  warning IDs ignored — pass; an unsuppressed scan reports exactly those seven
  allowed warnings and no vulnerability errors.
- Workflow validator — every executable GitHub Action reference is a full
  40-character commit SHA; tag annotations were resolved through GitHub's API.
- An initial attempt to run the full pnpm and Rust suites concurrently exhausted
  this Windows host's process memory (Vitest worker OOM and `rustc` linker
  termination). The authoritative sequential reruns above both passed; no test
  assertion failed in the resource-exhausted attempt.

