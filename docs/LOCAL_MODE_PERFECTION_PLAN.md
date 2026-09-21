# LOCAL MODE PERFECTION PLAN — v0.5.11 → v0.5.12

> Consolidated from 5 parallel deep reviews (2026-09-21). Every finding is `file:line` grounded, no fix applied yet. Execute strictly step-by-step — check boxes in order, never skip.

---

## Executive Summary

Local mode is **functionally correct and fail-closed** (HTTPS + SHA-256 + Ed25519 manifest + 16kHz FIR resample + single-source prefs) but has **~70 gaps** preventing "perfect" badge. 5 critical capability/symlink/race vectors and 15+ high UI/state inconsistencies remain. This plan makes local **first-class vs prototype** by fixing in dependency order: hardening → audio/state → UI/a11y → build/CI.

Total counts: **Critical 10, High 23, Medium 28, Low 15+**
- Most urgent: `W2` timeout Mutex leak (pill hangs), `D-01` symlink TOCTOU (arbitrary overwrite), `K-01` fallback 0600 race (token leak), `C-01` missing per-command ACL (pill can invoke any command), `C-01/Dashboard` lying Ready badge.

---

## Step-by-Step Execution Order (DO NOT REORDER)

### Phase 0 — Scaffolding & Verification Baseline
- [ ] 0.1 Create this plan file (done) + create `TodoWrite` list mirroring phases
- [ ] 0.2 Run baseline checks and capture outputs: `pnpm biome check`, `pnpm typecheck`, `pnpm test`, `cargo test`, `cargo clippy --all-targets`, `cargo audit`, `python sign-manifest.py check`
- [ ] 0.3 Tag current commit `perf-baseline` for diff

### Phase 1 — Hardening P0 (blocks perfect badge, security)
**Goal:** close privilege escalation, data leak, and bypass vectors before touching UX.

- [ ] 1.1 **C-01 Per-command ACL** — `apps/desktop-tauri/src-tauri/capabilities/*.json`, `src-tauri/src/lib.rs:828-877`
  - Add explicit command permissions (e.g. `local-asr:allow-download-model`, `session:allow-store-session`, `history:*`, `store:*`) to `main.json` (allow), deny from `floating-pill.json`; scope `settings.json` minimally. Generate `gen/schemas` with `tauri-plugin` ACL or use `capabilities` deny-list.
  - Scope `core:window:allow-*` and `core:app:default` → only needed verbs per window; `floating-pill` must not target `main` windows.

- [ ] 1.2 **D-01 Symlink TOCTOU on .part** — `local_asr/downloader.rs:524-530,343-378,461`
  - `symlink_metadata(part)` + `meta_path` reject if `is_symlink()` before `OpenOptions::open`; open with `O_NOFOLLOW` (Unix `custom_flags(libc::O_NOFOLLOW)` / Windows `FILE_FLAG_OPEN_REPARSE_POINT`); re-check after `create_dir_all`.

- [ ] 1.3 **D-02 Parent symlink walk** — `downloader.rs:356-369`
  - Canonicalize or iterate `cur` including `C:\` root; compare `canonicalize(parent)` prefix.

- [ ] 1.4 **K-01 Fallback 0600 race** — `src-tauri/src/lib.rs:222-231`
  - `OpenOptions::new().create_new(true).mode(0o600)` atomically, `fchmod` before write; `write_fallback_readme` same; `#[cfg(unix)]` only.

- [ ] 1.5 **K-02 Fallback over-broad trigger** — `lib.rs:336-339`
  - Remove `|| cfg!(target_os="linux")`; use `is_keyring_unavailable(e)` + explicit `contains("PlatformFailure"|"Secret Service"|"NoStorageAccess")` only; stop falling back on `NoEntry`/`Invalid`.

- [ ] 1.6 **K-04 Fallback symlink guard** — `lib.rs:207-211,222`
  - `symlink_metadata(fallback_path)` reject if symlink before `read_to_string` and before `write`.

- [ ] 1.7 **M-01 Unsigned-trusted branch** — `local_asr/manifest.rs:119-123`
  - Remove `if PUBKEY.is_empty() { Ok(()) }`; make verify `Err(model-download-failed)` when pubkey empty regardless of build guard; keep `build.rs:22-27` BUILD REJECTED as defense-in-depth.

- [ ] 1.8 **C-05/C-10 Opener/CSP scope** — `capabilities/main.json:34-38`, `settings.json:21-26`, `tauri.conf.json:29`
  - Tighten `*.githubusercontent.com` → `https://objects.githubusercontent.com/*`; add HuggingFace to `settings.json` opener (or document why omitted); remove `http://localhost:3001` from production CSP (gate with `devCsp` or `cfg(test)` only).

- [ ] 1.9 **DB-01 init_db swallowed** — `lib.rs:764-771`, `db.rs:70-88`
  - On `Err(e)` either `panic` or retry + surface `AppError::store` dialog; never silently continue without `Db` managed.

- [ ] 1.10 **L-01 Log loss on quit** — `lib.rs:628-633`, `logging.rs:69-75`
  - Remove `std::process::exit(0)` or `sync_all` before exit; keep only `app.exit(0)`; add `File::sync_all()` in `log_event` or delayed fallback exit after 500ms.

**Verification after Phase 1:** `cargo test`, `cargo clippy`, `biome check`, manual test: pill invoke `store_session` must be denied; symlink `tokenizer/vocab.json.part → Startup/evil.exe` must be rejected; fallback file perms `0600` atomically.

---

### Phase 2 — Audio Pipeline P0/P1 (blocks offline transcription fidelity & DoS)

- [ ] 2.1 **A1 FIR cutoff for upsample** — `local_asr/audio.rs:215`
  - `if from_rate < to_rate { filtered = input } else { lowpass 0.45*from_rate.min(to_rate)}` — preserve full BW on upsample (8k→16k should not low-pass at 3600 Hz).

- [ ] 2.2 **W2 Timeout Mutex leak** — `local_asr/worker.rs:752-791`
  - On `timeout Err`, `handle.abort()` + `unload` or drop engine lock; do not leave `spawn_blocking` holding `engine Mutex`.

- [ ] 2.3 **W1 TOCTOU double-load** — `worker.rs:593`
  - Re-check busy inside `set_lifecycle(Loading)` with lock held or `compare_exchange`; hold lock across `verify_model_files`.

- [ ] 2.4 **W3 RAM preflight** — `worker.rs:607-620`
  - `let mut sys = System::new(); sys.refresh_memory(); let need = (min_ram_gb*1024.0*1024.0*1024.0) as u64;` use binary GiB, not decimal 1e9.

- [ ] 2.5 **W4 Overlapping Transcribing** — `worker.rs:685`
  - Reject if `lifecycle==Transcribing` with `model-not-loaded busy` instead of queuing unbounded.

- [ ] 2.6 **F1 noiseSuppression** — `FloatingPill.tsx:281`
  - `noiseSuppression:{ideal:false}, echoCancellation:{ideal:false}, autoGainControl:{ideal:false}` when `mode==="local"`; keep true for cloud.

- [ ] 2.7 **F4 AudioContext sampleRate + resume** — `ptt.ts:221`
  - `new AudioContext({sampleRate:16000})` + `if(state==="suspended") await resume()`.

- [ ] 2.8 **F5 Empty decode guard** — `ptt.ts:229`
  - `if(!decoded.length||!decoded.numberOfChannels) throw new Error("decoded audio is empty")`.

- [ ] 2.9 **T1 local vs cloud size limit** — `push_to_talk.rs:383`
  - Branch: `if mode==Local { MAX_WAV_BYTES(128MB) } else { MAX_AUDIO_BYTES(25MB+1M) }`; local PTT must accept 30-100 MB WAV.

- [ ] 2.10 **A3 CPU bound DoS** — `audio.rs:225`
  - Cap `input.len` or reject `duration >30s` or chunk `resample_antialiased` before O(N*64) FIR on 128 MB WAV.

- [ ] 2.11 **F7 Length rounding** — `ptt.ts:283`
  - `Math.ceil((samples.length*16000)/sampleRate)`; document fallback packs at original rate on `OfflineAudioContext` failure.

**Verification:** Record 8 kHz input → verify 16 kHz output no 3.6kHz attenuation; concurrent `load_with` twice → only one succeeds; timeout test `slow_decode_hits_deadline` must not block next transcribe; `FloatingPill` 48k stereo → Rust FIR produces 16k mono correct; >30s WAV rejected with clear error.

---

### Phase 3 — Prefs/State P1 (blocks mode consistency & flash)

- [ ] 3.1 **1.8 Tauri __proto__ via IPC** — `prefs.ts:125-152`
  - `safeJsonParse(JSON.stringify(saved))` or `filterProtoKeys(saved)` before `buildPrefs` for Tauri path; add Rust write guard filtering `__proto__`.

- [ ] 3.2 **1.9 Pill migration capability** — `prefs.ts:138-139`, `capabilities/floating-pill.json:13`
  - Guard migration `if(!isPill)` or grant `store:allow-set/save` only to main/settings; make `loadPrefs(isMigrationAllowed=false)` for pill.

- [ ] 3.3 **2.1 withTimeout cancellation** — `hooks/useSplashSequence.ts:32-43,64-73`
  - `let cancelled=false;` set on timeout, guard inner `.then` with `if(cancelled) return;` or `AbortController`; fix secondary `ready=isSecondary?true:false` flash (should start false).

- [ ] 3.4 **2.3 updatePrefs serialization** — `App.tsx:110-132`
  - Serialize via `useRef` promise chain or `await`; capture `prev` via functional update or `lastSavedPrefs` ref; `await emit` before resolve; disable UI while saving.

- [ ] 3.5 **1.11 loadOnboarded fallback** — `prefs.ts:178-204`
  - Remove `localStorage` fallback in Tauri; catch should return `false` (force onboarding) or propagate; add verification readback like `savePrefs`.

- [ ] 3.6 **4.9 Settings window ACL** — `capabilities/settings.json:6-27`, `main.json`
  - Add `global-shortcut:allow-register/is-registered/unregister` to `settings.json` (or forbid hotkey edit in standalone window); ensure `local-asr:allow-*` commands are allowlisted.

- [ ] 3.7 **2.5 Listener leak** — `App.tsx:90-98`, `FloatingPill.tsx:389-414`, `useSplashSequence.ts:75-87`
  - `listen(...).then(u=>{ if(cancelled) u(); else unlisten=u })` on unmount; abort `sessionStatus` fetch on unmount.

- [ ] 3.8 **Default mode decision** — `prefs.ts:8`, `shared-types/schemas/voice.ts:10`, `ModeStep.tsx:30`
  - If product is LOCAL-first, change `DEFAULT_PREFS.mode="local"` + single `DEFAULT_MODE` constant exported from `shared-types`; if CLOUD-first, document and fix onboarding label `Cloud Recommended` consistency; sanitize `byok` via map or expose BYOK UI.

**Verification:** Fresh install default mode matches spec; rapid toggle Cloud→Local→Cloud with second save failure reverts correctly; secondary window no flash of wrong mode; pill migration no ACL denied; `__proto__` injection via `prefs.json` does not pollute.

---

### Phase 4 — Downloader/Manifest P1 (blocks fallback & integrity)

- [ ] 4.1 **D1 Checksum fallback** — `downloader.rs:393`
  - On `model-checksum-mismatch`, try `fallbackUrl` before returning Err (delete `.part` only after all URLs exhausted or keep per-url part isolation).

- [ ] 4.2 **D3 StorageFull miss** — `downloader.rs:195-204`
  - `if e.kind()==StorageFull || e.raw_os_error()==Some(28) || e.to_string().contains("No space")` → `model-insufficient-disk-space`.

- [ ] 4.3 **D4 No pre-flight in download_file** — `downloader.rs:download_file`, `commands.rs:148-150`
  - Add `check_free_space` inside `download_file` when `expected_size.is_some()`; reject `expected_size=None` with `free < DISK_HEADROOM`.

- [ ] 4.4 **D5 Loopback http gate** — `downloader.rs:93-116`
  - Gate `http://localhost` allow with `#[cfg(test)]` or `ALLOW_HTTP_LOOPBACK=1` env; production must reject.

- [ ] 4.5 **M-02 Build sig scan** — `build.rs:48-56`
  - Add `serde_json =1` build-dep, parse `Value`, `top["signature"].as_str()`.

- [ ] 4.6 **M-03 Sig length** — `build.rs:34-43`
  - Require `v.len()==128` (64 bytes) not `>=64`; `hex::decode` length check.

- [ ] 4.7 **M-09 Release-desktop sig gate** — `release-desktop.yml:28-46`
  - Add `pip install pynacl && python apps/desktop-tauri/src-tauri/scripts/sign-manifest.py check --manifest ... --pubkey ...` before `tauri-action`.

- [ ] 4.8 **Compat RAM gate** — `compat.rs:63` vs `worker.rs:607`
  - Unify both on `total` or `available`; document for 16GB total / 6GB free case.

- [ ] 4.9 **Progress ETA totalBytes loss** — `downloader.rs:34`, `models.rs:749`
  - Keep `Option<u64>` on wire or define `0=unknown` sentinel in `shared-types/schemas`.

**Verification:** Corrupt primary CDN hash → fallback succeeds; ENOSPC returns correct code and is not retried; `http://127.0.0.1` manifest URL rejected in prod; `build.rs` with 64-hex half-sig panics.

---

### Phase 5 — UI/UX P1 (blocks perfect local feel)

- [ ] 5.1 **Dashboard lying Ready** — `DashboardView.tsx:104-113`
  - Derive `health = mode==="local" && !activeModelId ? "Setup needed"` + `bg-amber-500` dot `aria-label="Local mode — no model"`.

- [ ] 5.2 **DictateView pillMsg persistence** — `DictateView.tsx:34,255-268`
  - `useEffect` timeout 5000ms + cleanup auto-dismiss like `FloatingPill.NOTICE_MS`.

- [ ] 5.3 **DictateView amber heuristic** — `DictateView.tsx:258-264`
  - Branch on `errorCode` kebab-case, map all `error.rs:57-123` codes to `bg-amber-50`.

- [ ] 5.4 **DictateView local hint when no model** — `DictateView.tsx:269-274`, `SettingsView.tsx:249` contrast
  - Pass `activeModelId` prop; show amber `No local model selected — download…` + `role=alert`; wrap Settings warn `bg-amber-50 border-amber-200 text-amber-800` to fix 2.8:1 contrast.

- [ ] 5.5 **ModelStep Tavsiya leak** — `onboarding/ModelStep.tsx:150`
  - `Recommended` English; `bg-white text-black` keep.

- [ ] 5.6 **Auto-pick duplication** — `ModelStep.tsx:32-56`, `OnboardingView.tsx:119-170`
  - Single `pickRecommended(models, compat, hardware)` in `lib/localModels`.

- [ ] 5.7 **Delete active model leaves local+null** — `ModelManager.tsx:243`, `prefs.ts:88-98`
  - Prompt `Local needs a model — switch to Cloud?` or auto-coerce `mode==="local" && !activeModelId` → cloud or blocking modal.

- [ ] 5.8 **ModelManager swallowed hardware errors** — `ModelManager.tsx:135-145`
  - Set `hardwareError` state, render `Hardware detection failed — retry` button.

- [ ] 5.9 **FloatingPill kebab mismatch** — `FloatingPill.tsx:206-214`
  - Match `model-not-loaded`, `model-not-found`, `model-checksum-mismatch`, `model-insufficient-disk-space`, `model-incompatible`, `audio-unsupported-format`, `out-of-memory`; use `toLowerCase().includes("groq")`.

- [ ] 5.10 **Transcribing local reassurance** — `DictateView.tsx:154-166`, `FloatingPill.tsx:454-459`
  - Conditional `Transcribing locally — audio stays on device` + offline hint `~1s`.

- [ ] 5.11 **Onboarding mode persistence** — `OnboardingView.tsx:388-389`
  - Persist `mode` only after `finishLocalSetup` or transactionally; show `Creating engine…` via `onModelLoadProgress` in `ReadyStep`.

**Verification:** Dashboard shows amber when local+null; Dictate pill clears after 5s; all error codes show amber; delete active model prompts; hardware failure shows retry; local transcribe shows offline reassurance.

---

### Phase 6 — A11y & Polish P2

- [ ] 6.1 **WCAG contrast** — `SettingsView.tsx:249`, `onboarding/ModelStep.tsx:198-201`, `ModelManager.tsx:376-394`
  - `text-white/25` → `text-white/60` + `bg-white/[0.03]`; amber/text ratios ≥4.5:1 via `bg-amber-50` wrappers.

- [ ] 6.2 **ARIA roles** — `onboarding/ModelStep.tsx:127-195`, `StepProgress.tsx:1-16`, `ModelManager.tsx:376-394`
  - `role=radiogroup` + `role=radio` + `aria-checked`, `StepProgress` `ol` + `aria-current=step`; search `Input` with `aria-label="Search models"` + visible `<label>`.

- [ ] 6.3 **FloatingPill drag affordance** — `FloatingPill.tsx:462-482`
  - Enlarge rim + `cursor-grab` only on rim, add tooltip `Drag edges to move` + `aria-describedby`.

- [ ] 6.4 **Error path paths leak E-01** — `downloader.rs:187-189`, `error.rs`
  - Strip `app_data_dir` prefix, show `<model-id>/<filename>` only; never persist `C:\Users\<username>\…` in log/frontend.

- [ ] 6.5 **Duplicate toasts** — `SettingsView.tsx:87-152` + `FloatingPill.tsx:206-227`
  - Dedup: inline only for Settings, OS notification only if window hidden; pill → main mirror `emit` OR local notice, not both.

- [ ] 6.6 **build.rs script path** — `build.rs:37-41`
  - Fix to `python3 src-tauri/scripts/sign-manifest.py sign --key <seed> --manifest src-tauri/src/local_asr/default_manifest.json` (repo root aware).

---

### Phase 7 — Build/CI P1 (blocks shippability)

- [ ] 7.1 **CI cargo audit fail-closed** — `.github/workflows/ci.yml:131-133`
  - `cargo audit --deny warnings` or allowlist with expiry; remove `|| echo triage`.

- [ ] 7.2 **CI gitleaks fail-closed** — `ci.yml:89-102`
  - Pin `zricethezav/gitleaks:v8.22.1` digest, fail on any `code!=0`.

- [ ] 7.3 **local-stt-verify on PR** — `local-stt-verify.yml:15-17`
  - `on: pull_request paths: ["apps/desktop-tauri/src-tauri/src/local_asr/**"]` or fold into nightly `ci.yml`.

- [ ] 7.4 **release-desktop version gate lockfile** — `release-desktop.yml:34-39`
  - Add `cargo --locked` check + `git diff --exit-code Cargo.lock pnpm-lock.yaml`.

- [ ] 7.5 **Canonical escaping divergence** — `sign-manifest.py:54-96` vs `manifest.rs:103-108`
  - Pin corpus with non-ASCII `— ë \u2028` and assert `canonical_models_bytes == serde_json::to_vec`.

- [ ] 7.6 **manifest sampleRate contract** — `default_manifest.json`, `manifest.rs: LocalModel`
  - Add `sampleRate: 16000` field, validate `==16000`.

- [ ] 7.7 **H-01 Double auth-callback emit** — `lib.rs:711-719`
  - Deduplicate to single `emit("auth-callback", filtered)`; remove `handle_argv_deep_links` duplicate.

- [ ] 7.8 **E-03 Stable codes** — `error.rs:165-206`
  - Add `transcribe`, `paste`, `tray`, `window`, `session`, `shortcut` to stable test.

---

### Phase 8 — Final Verification (perfect gate)

- [ ] 8.1 `pnpm biome check --write` passes, no new `a11y` regressions
- [ ] 8.2 `pnpm typecheck` passes (no `allow(non_snake_case)` leftovers beyond bridge)
- [ ] 8.3 `pnpm test` 63+ pass, `cargo test` all green, `cargo clippy -- -D warnings` clean
- [ ] 8.4 `sign-manifest.py check --manifest … --pubkey …` passes + `cargo test bundled_manifest_verifies_against_baked_pubkey`
- [ ] 8.5 Manual QA matrix:
  - [ ] Fresh install → local default + amber warning → download parakeet → transcribe offline → Dashboard badge Local ready
  - [ ] Cloud mode → Groq key → transcribe → switch to local → no Groq hint flash
  - [ ] Rapid toggle 3× → no stale prefs
  - [ ] Corrupt primary hash → fallback succeeds
  - [ ] Disk full → correct code, no retry loop
  - [ ] Pill drag, multi-monitor, frameless WebView2 not stuck `about:blank`
  - [ ] Hardware compat: 16GB total / 2GB avail → correctly blocked or warned
  - [ ] Symlink attack `.part` → rejected
  - [ ] Fallback file `0600` atomic, not world-readable
- [ ] 8.6 Tag `v0.5.12` + push → `release` + `release-desktop` green, artifacts attached

---

## Findings Index (full, deduplicated)

### Critical (fix first)
| ID | File:Line | Issue |
|----|-----------|-------|
| C-01 | `capabilities/*.json`, `lib.rs:828` | No per-command ACL — pill can invoke any command |
| D-01 | `downloader.rs:524` | TOCTOU symlink on `.part`/`.part.json` → arbitrary overwrite |
| K-01 | `lib.rs:222` | Fallback write 644 window → token leak |
| M-01 | `manifest.rs:119` | Empty pubkey trusts unsigned manifest if build bypassed |
| DB-01 | `lib.rs:764` | init_db failure swallowed → app without Db |
| W2 | `worker.rs:752` | Timeout leaves engine Mutex held → DoS |
| W1 | `worker.rs:593` | Double-load TOCTOU race |
| C-01-Dash | `DashboardView.tsx:104` | Lying Ready badge for local+null |
| A1 | `audio.rs:215` | Upsample cutoff loses 3.6-4kHz |
| C pill | `floating-pill.json:13` | Pill migration store:allow-set denied → stale prefs |

### High (23)
F1 noiseSuppression, F4 AudioContext, F5 empty decode, W3 RAM preflight, W4 overlapping, T1 size limit, D1 fallback, K-02 over-broad, L-01 log loss, CI-01 audit soft-fail, CI-02 gitleaks soft-fail, E-01 path leak, M-02 scan, M-03 len, 1.8 __proto__, 2.1 withTimeout, 2.3 updatePrefs, 4.9 ACL, Dashboard pillMsg persist, Dictate amber miss, ModelStep Tavsiya, hardware swallow, etc. (full in phases above)

### Medium/Low — see phases 5-7 for exhaustive list.

---

## How to use this file
1. Work strictly top-to-bottom; never jump to UI before hardening.
2. After each phase, run its Verification checklist; commit with `fix(phase-N): <id> description`.
3. Keep this file as source of truth — update `[x]` as you go; do not create separate todos that diverge.
4. If a fix reveals a new issue, append to `## Deferred` below with file:line and re-prioritize — do not silently ignore.

---

## Deferred (append new discoveries here)
- (none yet)

