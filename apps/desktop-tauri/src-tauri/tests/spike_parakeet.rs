//! Spike 0: validate sherpa-onnx + real Parakeet TDT 0.6B v3 (INT8) on Windows.
//!
//! This test is *gated*: it only runs the real inference when the
//! `SHERPA_PARAKEET_MODEL_DIR` environment variable points at an extracted
//! `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` bundle directory containing
//! `encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx` and
//! `tokens.txt`. Otherwise it prints a skip notice and passes, so a plain
//! `cargo test` (dev machines, CI jobs without the fixture) stays green.
//!
//! The audio file comes from `SHERPA_TEST_WAV`, defaulting to the English
//! sample shipped inside the bundle (`test_wavs/en.wav`).
//!
//! To run for real (Windows x64, CPU):
//! ```powershell
//! # 1. fetch the bundle (~670 MB) once, e.g. with huggingface-cli:
//! #    huggingface-cli download csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 `
//! #      --local-dir C:\models\parakeet-v3-int8
//! $env:SHERPA_PARAKEET_MODEL_DIR = 'C:\models\parakeet-v3-int8'
//! cargo test --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml --test spike_parakeet -- --nocapture
//! ```

use algorith_voice_desktop_lib::local_asr::audio::decode_wav;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn model_file(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    assert!(
        path.is_file(),
        "spike fixture missing: {} (is SHERPA_PARAKEET_MODEL_DIR an extracted bundle?)",
        path.display()
    );
    path
}

#[test]
fn spike_parakeet_tdt_v3_offline_transcription() {
    let dir = match std::env::var("SHERPA_PARAKEET_MODEL_DIR") {
        Ok(d) if Path::new(&d).is_dir() => PathBuf::from(d),
        _ => {
            eprintln!(
                "SKIPPED spike_parakeet: set SHERPA_PARAKEET_MODEL_DIR to an extracted \
                 sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 bundle to run real inference"
            );
            return;
        }
    };

    let encoder = model_file(&dir, "encoder.int8.onnx");
    let decoder = model_file(&dir, "decoder.int8.onnx");
    let joiner = model_file(&dir, "joiner.int8.onnx");
    let tokens = model_file(&dir, "tokens.txt");

    let wav_path = std::env::var("SHERPA_TEST_WAV")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dir.join("test_wavs").join("en.wav"));
    assert!(
        wav_path.is_file(),
        "spike audio missing: {} (set SHERPA_TEST_WAV to a WAV file)",
        wav_path.display()
    );

    // The production audio pipeline normalizes any rate/channels to the
    // 16 kHz mono the engine consumes — the spike exercises that path too.
    let raw = std::fs::read(&wav_path).expect("read fixture wav");
    let decoded = decode_wav(&raw).expect("decode fixture wav");
    assert!(
        !decoded.samples.is_empty(),
        "fixture WAV contains no samples"
    );

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: Some(encoder.to_string_lossy().into_owned()),
        decoder: Some(decoder.to_string_lossy().into_owned()),
        joiner: Some(joiner.to_string_lossy().into_owned()),
    };
    config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
    config.model_config.model_type = Some("nemo_transducer".to_string());
    config.model_config.num_threads = 2;
    config.model_config.provider = Some("cpu".to_string());

    let recognizer =
        OfflineRecognizer::create(&config).expect("OfflineRecognizer::create must succeed");
    let stream = recognizer.create_stream();
    stream.accept_waveform(16000, &decoded.samples);

    let started = Instant::now();
    recognizer.decode(&stream);
    let elapsed = started.elapsed();

    let result = stream.get_result().expect("decode must produce a result");
    let audio_secs = decoded.duration_secs();
    eprintln!("spike transcript : {:?}", result.text);
    eprintln!(
        "spike timing     : {:.2}s audio in {:.2}s ({:.1}x realtime)",
        audio_secs,
        elapsed.as_secs_f64(),
        audio_secs / elapsed.as_secs_f64().max(f64::EPSILON)
    );
    eprintln!("spike timestamps : {:?}", result.timestamps);

    assert!(
        !result.text.trim().is_empty(),
        "spike FAILED: recognizer returned empty text (see RealtimeSTT Windows caveat)"
    );
}
