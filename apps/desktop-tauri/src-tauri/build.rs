use std::path::Path;

fn main() {
    // Release-safety guard: the model manifest must be signed AND a signing
    // pubkey must be baked in, otherwise the runtime fail-closed behavior in
    // `verify_manifest_signature()` would refuse every download in the
    // shipped app. Failing here (all profiles) means an unsigned manifest
    // can never silently ship — editing `default_manifest.json` models
    // requires re-running `scripts/sign-manifest.py sign` first.
    // (Cryptographic validity itself is proven by the
    // `bundled_manifest_verifies_against_baked_pubkey` unit test, which CI
    // runs via `cargo test`; this guard covers the structural half without
    // needing the ed25519 crate in the build script.)
    enforce_signed_manifest();
    tauri_build::build()
}

fn enforce_signed_manifest() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_asr");
    println!("cargo:rerun-if-changed=src/local_asr/manifest_signing_pubkey.hex");
    println!("cargo:rerun-if-changed=src/local_asr/default_manifest.json");
    let pubkey =
        std::fs::read_to_string(dir.join("manifest_signing_pubkey.hex")).unwrap_or_default();
    if pubkey.trim().len() != 64 || !pubkey.trim().bytes().all(|b| b.is_ascii_hexdigit()) {
        panic!(
            "BUILD REJECTED: src/local_asr/manifest_signing_pubkey.hex must contain \
             the 32-byte Ed25519 signing pubkey as hex (see scripts/sign-manifest.py keygen). \
             Shipping without it would leave the model manifest unverifiable."
        );
    }
    let manifest = std::fs::read_to_string(dir.join("default_manifest.json")).unwrap_or_default();
    // Ed25519 signature is 64 bytes = 128 hex chars. Structural check via
    // textual scan (cryptographic validity is proven by unit test).
    let has_signature = extract_signature_value(&manifest)
        .is_some_and(|v| v.len() == 128 && v.bytes().all(|b| b.is_ascii_hexdigit()));
    if !has_signature {
        panic!(
            "BUILD REJECTED: src/local_asr/default_manifest.json carries no \
             valid 128-hex model-manifest signature. Re-sign it with \
             `python3 apps/desktop-tauri/src-tauri/scripts/sign-manifest.py sign --key <seed> \
             --manifest apps/desktop-tauri/src-tauri/src/local_asr/default_manifest.json` before building."
        );
    }
}

/// Value of the first top-level-looking `"signature": "<hex>"` pair, if any.
fn extract_signature_value(manifest: &str) -> Option<&str> {
    let key = manifest.find("\"signature\"")?;
    let after_key = &manifest[key + "\"signature\"".len()..];
    let colon = after_key.find(':')?;
    let quoted = after_key[colon + 1..].trim_start().strip_prefix('"')?;
    let end = quoted.find('"')?;
    Some(&quoted[..end])
}
