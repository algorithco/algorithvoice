# Privacy Policy — Algorith Voice (MVP)

**Local-first.** Core dictation with the local model runs fully offline: audio never leaves your device, no account required for local mode.

**Cloud (opt-in only).** Cloud transcription (`Voxtral Realtime` primary, OpenRouter fallback) sends audio to our backend which proxies to the provider. Metering records minutes/requests — never raw audio — unless you explicitly enable audio-history storage (R2, off by default, 30-day auto-delete).

**Sync (opt-in, off by default).** Hotkey prefs, dictionary, history sync only if you toggle it on.

**No telemetry by default.** No analytics SDK, no ads, no cross-app tracking in MVP. Crash reports, if added later, will be opt-in and scrubbed.

**BYOK.** Your provider key is envelope-encrypted at rest (AES-256-GCM, per-row DEK wrapped by KEK), decrypted only in-memory per request, shown as `••••last4` only.

**Your rights (GDPR Art. 6/7/17).** Access, rectify, erase, restrict, port via in-app delete + support contact. Subprocessors: Stripe (billing), Google/GitHub (OAuth, if used), Mistral/OpenRouter (cloud STT, only when you use cloud mode).

**Retention.** Transcripts deletable anytime; usage ledgers kept for billing disputes (90d hot + archive); audit logs hash IPs with rotating salt.
