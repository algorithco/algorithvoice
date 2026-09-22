//! Gated smoke test for any model from the bundled catalog.
//!
//! This exercises the same model-family resolution and Sherpa configuration
//! as production without making CI download multi-gigabyte fixtures. Point it
//! at an already-installed model to run it locally:
//!
//! ```powershell
//! $env:SHERPA_MODEL_ID = 'whisper-small'
//! $env:SHERPA_MODEL_DIR = "$env:APPDATA\com.algorithvoice.app\models\whisper-small"
//! cargo test --test local_model_smoke -- --nocapture
//! ```

use algorith_voice_desktop_lib::local_asr::manifest::{default_manifest, validate_manifest};
use algorith_voice_desktop_lib::local_asr::worker::{LocalTranscriber, SherpaTranscriber};
use std::path::PathBuf;

#[test]
fn installed_catalog_model_loads_and_decodes() {
    let (id, dir) = match (
        std::env::var("SHERPA_MODEL_ID"),
        std::env::var("SHERPA_MODEL_DIR"),
    ) {
        (Ok(id), Ok(dir)) if PathBuf::from(&dir).is_dir() => (id, PathBuf::from(dir)),
        _ => {
            eprintln!("SKIPPED local_model_smoke: set SHERPA_MODEL_ID and SHERPA_MODEL_DIR");
            return;
        }
    };

    let manifest = default_manifest().expect("bundled manifest parses");
    validate_manifest(&manifest).expect("bundled manifest is valid");
    let model = manifest
        .models
        .iter()
        .find(|model| model.id == id)
        .unwrap_or_else(|| panic!("{id} is not in the bundled model catalog"));

    let transcriber =
        SherpaTranscriber::load(model, &dir, "auto").expect("installed model must load");
    let silence = vec![0.0_f32; 8_000];
    transcriber
        .transcribe(&silence, "auto")
        .expect("installed model must run one decode");
}
