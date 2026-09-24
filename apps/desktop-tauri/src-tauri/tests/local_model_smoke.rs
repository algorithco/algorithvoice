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

    let language = std::env::var("SHERPA_TEST_LANGUAGE").unwrap_or_else(|_| "auto".to_string());
    let transcriber =
        SherpaTranscriber::load(model, &dir, &language).expect("installed model must load");
    if let Ok(wav_path) = std::env::var("SHERPA_TEST_WAV") {
        let wav = std::fs::read(&wav_path).expect("test WAV must be readable");
        let audio = algorith_voice_desktop_lib::local_asr::audio::decode_wav(&wav)
            .expect("test WAV must decode through the production audio pipeline");
        let transcript = transcriber
            .transcribe(&audio.samples, &language)
            .expect("installed model must transcribe the test WAV");
        eprintln!("local model transcript: {}", transcript.text);
        assert!(
            !transcript.text.trim().is_empty(),
            "spoken test WAV must produce a transcript"
        );
    } else {
        let silence = vec![0.0_f32; 8_000];
        transcriber
            .transcribe(&silence, &language)
            .expect("installed model must run one decode");
    }
}
