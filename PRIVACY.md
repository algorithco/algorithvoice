# Privacy Policy — Algorith Voice (MVP)

**Local-first.** Core dictation with the 6 on-device `sherpa-onnx` models (`parakeet-tdt-0.6b-v3`, `whisper-*`, `qwen3-asr-1.7b`, `distil-large-v3.5`) runs fully offline: audio never leaves your device, no account required for local mode. Models are fetched once from `https://huggingface.co/algorithco/*` over HTTPS and re-verified by SHA-256 before activation; `Settings → Local` shows license/attribution per model (CC-BY-4.0/MIT/Apache-2.0) and hardware/disk gates.

**Cloud (opt-in only).** Cloud transcription (`Voxtral Realtime` primary, OpenRouter fallback) sends audio to our backend which proxies to the provider. Metering records minutes/requests — never raw audio — unless you explicitly enable audio-history storage (R2, off by default, 30-day auto-delete).

**Sync (opt-in, off by default).** Hotkey prefs, dictionary, history sync only if you toggle it on.

**No telemetry by default.** No analytics SDK, no ads, no cross-app tracking in MVP. Crash reports, if added later, will be opt-in and scrubbed.

**Local usage meter.** `Settings → Local usage` counts on-device transcriptions (sessions, audio seconds in, words out) in the desktop app's local database. Only counts are stored — never audio, never transcript text — and they never leave the device; clearing them is one tap.

**BYOK.** Your provider key is envelope-encrypted at rest (AES-256-GCM, per-row DEK wrapped by KEK), decrypted only in-memory per request, shown as `••••last4` only.

**Your rights (GDPR Art. 6/7/17).** Access, rectify, erase, restrict, port via in-app delete + support contact. Subprocessors: Stripe (billing), Google/GitHub (OAuth, if used), Mistral/OpenRouter (cloud STT, only when you use cloud mode).

**Retention.** Transcripts deletable anytime; usage ledgers kept for billing disputes (90d hot + archive); audit logs hash IPs with rotating salt.
