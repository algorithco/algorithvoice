//! Local transcription worker: engine trait, Sherpa implementation, lifecycle.
//!
//! One worker owns at most one loaded model. All blocking work (model load,
//! decode) is driven through async boundaries by the caller — the methods
//! that block say so on the tin. Transcription never falls back to cloud
//! here: failures surface as typed errors for the caller to route.
//!
//! Sample contract: 16 kHz mono `f32` in, transcript out. Normalization is
//! the audio pipeline's job, not the engine's.

use crate::error::AppError;
use crate::local_asr::audio::TARGET_SAMPLE_RATE;
use crate::local_asr::manifest::{LocalModel, ModelEngine};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// Default decode deadline. Chunk PTT audio is seconds long and INT8 CPU
/// decodes far faster than realtime; this is a backstop, not a budget.
pub const DEFAULT_TRANSCRIBE_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start_secs: f64,
    pub end_secs: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    pub segments: Vec<TranscriptSegment>,
    /// Language tag as passed in, or `None` for auto-detect.
    pub language: Option<String>,
}

impl Transcript {
    fn empty() -> Self {
        Self {
            text: String::new(),
            segments: Vec::new(),
            language: None,
        }
    }
}

/// Engine boundary: implement for Sherpa today (and a future Whisper.cpp or
/// sidecar runtime) without touching callers. Methods are synchronous; the
/// lifecycle manager below provides the async shell with timeouts.
pub trait LocalTranscriber: Send + Sync {
    fn model_id(&self) -> &str;
    /// Decode 16 kHz mono samples. Blocking. `language` is recorded as
    /// metadata; v1 engines all auto-detect (whisper loads with an empty
    /// language for auto mode — per-language loads are future work).
    fn transcribe(&self, samples: &[f32], language: &str) -> Result<Transcript, AppError>;
}

/// Which Sherpa model family a manifest entry maps to, derived from its
/// listed filenames (encoder/decoder/joiner vs whisper pair vs Qwen3
/// frontend). Pure function of the manifest — no disk access.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SherpaFamily {
    /// Parakeet-style transducer: encoder + decoder + joiner + tokens.
    Transducer {
        encoder: String,
        decoder: String,
        joiner: String,
        tokens: String,
    },
    /// Whisper-style encoder/decoder + tokens.
    Whisper {
        encoder: String,
        decoder: String,
        tokens: String,
    },
    /// Qwen3-ASR: conv frontend + encoder + decoder + tokenizer dir.
    Qwen3 {
        frontend: String,
        encoder: String,
        decoder: String,
        tokenizer_dir: String,
    },
}

fn find_file<'m>(model: &'m LocalModel, mut matches: impl FnMut(&str) -> bool) -> Option<&'m str> {
    model
        .files
        .iter()
        .map(|f| f.filename.as_str())
        .find(|name| matches(name))
}

pub(crate) fn resolve_sherpa_family(model: &LocalModel) -> Result<SherpaFamily, AppError> {
    if model.engine != ModelEngine::SherpaOnnx {
        return Err(AppError::engine_init_failed(format!(
            "model {} needs engine {:?}, which is not bundled in this build",
            model.id, model.engine
        )));
    }
    let onnx = |marker: &str| find_file(model, |n| n.ends_with(".onnx") && n.contains(marker));
    let tokens = || find_file(model, |n| n.contains("token") && n.ends_with(".txt"));
    if onnx("joiner").is_some() {
        let need = |what: &str, found: Option<&str>| {
            found
                .map(str::to_owned)
                .ok_or_else(|| missing_part(&model.id, what))
        };
        return Ok(SherpaFamily::Transducer {
            encoder: need("encoder ONNX", onnx("encoder"))?,
            decoder: need("decoder ONNX", onnx("decoder"))?,
            joiner: need("joiner ONNX", onnx("joiner"))?,
            tokens: need("tokens.txt", tokens())?,
        });
    }
    if onnx("conv_frontend")
        .or_else(|| onnx("conv-frontend"))
        .is_some()
    {
        let need = |what: &str, found: Option<&str>| {
            found
                .map(str::to_owned)
                .ok_or_else(|| missing_part(&model.id, what))
        };
        // Tokenizer files share one directory (e.g. `tokenizer/`); the
        // engine takes the directory, so require at least the vocab.
        let vocab = find_file(model, |n| {
            n.ends_with("vocab.json") && n.contains("tokenizer")
        });
        let tokenizer_dir = vocab
            .and_then(|v| v.rsplit_once('/').map(|(dir, _)| dir.to_string()))
            .ok_or_else(|| missing_part(&model.id, "tokenizer/ directory with vocab.json"))?;
        return Ok(SherpaFamily::Qwen3 {
            frontend: need(
                "conv frontend ONNX",
                onnx("conv_frontend").or_else(|| onnx("conv-frontend")),
            )?,
            encoder: need("encoder ONNX", onnx("encoder"))?,
            decoder: need("decoder ONNX", onnx("decoder"))?,
            tokenizer_dir,
        });
    }
    // Default: whisper-style encoder/decoder pair.
    let need = |what: &str, found: Option<&str>| {
        found
            .map(str::to_owned)
            .ok_or_else(|| missing_part(&model.id, what))
    };
    Ok(SherpaFamily::Whisper {
        encoder: need("encoder ONNX", onnx("encoder"))?,
        decoder: need("decoder ONNX", onnx("decoder"))?,
        tokens: need("tokens file", tokens())?,
    })
}

fn missing_part(model_id: &str, what: &str) -> AppError {
    AppError::engine_init_failed(format!(
        "model {model_id} is missing its {what}; re-download the model"
    ))
}

/// Sherpa ONNX implementation of [`LocalTranscriber`].
pub struct SherpaTranscriber {
    model_id: String,
    recognizer: sherpa_onnx::OfflineRecognizer,
}

impl std::fmt::Debug for SherpaTranscriber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The recognizer holds native engine state without a Debug impl;
        // identify by model only (also keeps weights out of logs).
        f.debug_struct("SherpaTranscriber")
            .field("model_id", &self.model_id)
            .finish_non_exhaustive()
    }
}

impl SherpaTranscriber {
    /// Load and validate a model directory. Blocking for seconds (hundreds
    /// of MB of weights) — callers must offload (see `TranscriptionWorker`).
    pub fn load(model: &LocalModel, dir: &Path) -> Result<Self, AppError> {
        let family = resolve_sherpa_family(model)?;
        // Every listed file must exist before the engine touches anything:
        // a half-present directory is a re-download case, not a decode case.
        match &family {
            SherpaFamily::Transducer {
                encoder,
                decoder,
                joiner,
                tokens,
            } => {
                for name in [encoder, decoder, joiner, tokens] {
                    require_file(dir, name, &model.id)?;
                }
            }
            SherpaFamily::Whisper {
                encoder,
                decoder,
                tokens,
            } => {
                for name in [encoder, decoder, tokens] {
                    require_file(dir, name, &model.id)?;
                }
            }
            SherpaFamily::Qwen3 {
                frontend,
                encoder,
                decoder,
                tokenizer_dir,
            } => {
                for name in [frontend, encoder, decoder] {
                    require_file(dir, name, &model.id)?;
                }
                if !dir.join(tokenizer_dir).is_dir() {
                    return Err(missing_part(&model.id, "tokenizer/ directory"));
                }
            }
        }
        let join = |dir: &Path, name: &str| dir.join(name).to_string_lossy().into_owned();
        let mut config = sherpa_onnx::OfflineRecognizerConfig::default();
        match family {
            SherpaFamily::Transducer {
                encoder,
                decoder,
                joiner,
                tokens,
            } => {
                config.model_config.transducer = sherpa_onnx::OfflineTransducerModelConfig {
                    encoder: Some(join(dir, &encoder)),
                    decoder: Some(join(dir, &decoder)),
                    joiner: Some(join(dir, &joiner)),
                };
                config.model_config.tokens = Some(join(dir, &tokens));
                config.model_config.model_type = Some("nemo_transducer".to_string());
            }
            SherpaFamily::Whisper {
                encoder,
                decoder,
                tokens,
            } => {
                // Empty language = auto-detect (matches upstream sherpa
                // behavior); per-language loads are future work.
                config.model_config.whisper = sherpa_onnx::OfflineWhisperModelConfig {
                    encoder: Some(join(dir, &encoder)),
                    decoder: Some(join(dir, &decoder)),
                    language: Some(String::new()),
                    task: Some("transcribe".to_string()),
                    ..Default::default()
                };
                config.model_config.tokens = Some(join(dir, &tokens));
            }
            SherpaFamily::Qwen3 {
                frontend,
                encoder,
                decoder,
                tokenizer_dir,
            } => {
                config.model_config.qwen3_asr = sherpa_onnx::OfflineQwen3ASRModelConfig {
                    conv_frontend: Some(join(dir, &frontend)),
                    encoder: Some(join(dir, &encoder)),
                    decoder: Some(join(dir, &decoder)),
                    tokenizer: Some(join(dir, &tokenizer_dir)),
                    ..Default::default()
                };
            }
        }
        config.model_config.num_threads = default_threads();
        config.model_config.provider = Some("cpu".to_string());
        config.model_config.debug = false;
        let recognizer = sherpa_onnx::OfflineRecognizer::create(&config).ok_or_else(|| {
            AppError::engine_init_failed(format!(
                "sherpa could not initialise model {} (bad weights or unsupported hardware)",
                model.id
            ))
        })?;
        Ok(Self {
            model_id: model.id.clone(),
            recognizer,
        })
    }
}

fn require_file(dir: &Path, name: &str, model_id: &str) -> Result<(), AppError> {
    if dir.join(name).is_file() {
        Ok(())
    } else {
        Err(missing_part(model_id, &format!("file {name}")))
    }
}

fn default_threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().min(4))
        .ok()
        .and_then(|n| i32::try_from(n).ok())
        .unwrap_or(2)
}

impl LocalTranscriber for SherpaTranscriber {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn transcribe(&self, samples: &[f32], language: &str) -> Result<Transcript, AppError> {
        if samples.is_empty() {
            return Ok(Transcript::empty());
        }
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(TARGET_SAMPLE_RATE as i32, samples);
        self.recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| AppError::engine_init_failed("sherpa returned no result"))?;
        let text = result.text.trim().to_string();
        let duration = samples.len() as f64 / f64::from(TARGET_SAMPLE_RATE);
        let reported_language = match language.trim() {
            "" | "auto" => None,
            other => Some(other.to_string()),
        };
        Ok(Transcript {
            segments: vec![TranscriptSegment {
                start_secs: 0.0,
                end_secs: duration,
                text: text.clone(),
            }],
            text,
            language: reported_language,
        })
    }
}

/// Observable worker lifecycle (status queries only; transitions below).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkerLifecycle {
    Unloaded,
    Loading,
    Ready,
    Transcribing,
    Failed,
}

/// Load progress stages. Engine creation is monolithic inside sherpa, so
/// stages mark our milestones, not weight percentages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoadStage {
    ResolvingFiles,
    CreatingEngine,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStatus {
    pub lifecycle: WorkerLifecycle,
    pub model_id: Option<String>,
    pub failure: Option<String>,
}

struct WorkerInner {
    lifecycle: WorkerLifecycle,
    engine: Option<std::sync::Arc<Mutex<Box<dyn LocalTranscriber>>>>,
    model_id: Option<String>,
    failure: Option<String>,
}

/// Owns one loaded engine with explicit lifecycle. All methods are cheap
/// except `load` (blocking, offload it) and `transcribe` (async shell over
/// a blocking decode with deadline + empty-result retry).
pub struct TranscriptionWorker {
    inner: Mutex<WorkerInner>,
    transcribe_timeout: Duration,
}

impl TranscriptionWorker {
    pub fn new() -> Self {
        Self::with_timeout(Duration::from_secs(DEFAULT_TRANSCRIBE_TIMEOUT_SECS))
    }

    pub fn with_timeout(transcribe_timeout: Duration) -> Self {
        Self {
            inner: Mutex::new(WorkerInner {
                lifecycle: WorkerLifecycle::Unloaded,
                engine: None,
                model_id: None,
                failure: None,
            }),
            transcribe_timeout,
        }
    }

    pub fn status(&self) -> WorkerStatus {
        match self.inner.lock() {
            Ok(inner) => WorkerStatus {
                lifecycle: inner.lifecycle,
                model_id: inner.model_id.clone(),
                failure: inner.failure.clone(),
            },
            Err(poisoned) => {
                // A previous holder panicked while holding the lock. Report
                // failure (with whatever identity survived) instead of
                // panicking in a status query.
                let inner = poisoned.into_inner();
                WorkerStatus {
                    lifecycle: WorkerLifecycle::Failed,
                    model_id: inner.model_id.clone(),
                    failure: Some(
                        inner
                            .failure
                            .clone()
                            .unwrap_or_else(|| "worker state is unavailable".to_string()),
                    ),
                }
            }
        }
    }

    /// Load a model with the production Sherpa loader. Blocking — callers
    /// must move it off the async executor (spawn_blocking at the command
    /// layer, as with clipboard paste).
    pub fn load(
        &self,
        model: &LocalModel,
        dir: &Path,
        on_stage: impl Fn(LoadStage),
    ) -> Result<(), AppError> {
        self.load_with(model, dir, on_stage, |model, dir| {
            Ok(Box::new(SherpaTranscriber::load(model, dir)?) as Box<dyn LocalTranscriber>)
        })
    }

    /// Load with an injected engine factory (tests). Same lifecycle rules.
    pub fn load_with(
        &self,
        model: &LocalModel,
        dir: &Path,
        on_stage: impl Fn(LoadStage),
        loader: impl FnOnce(&LocalModel, &Path) -> Result<Box<dyn LocalTranscriber>, AppError>,
    ) -> Result<(), AppError> {
        {
            let inner = self
                .inner
                .lock()
                .map_err(|_| AppError::engine_init_failed("worker state is unavailable"))?;
            match inner.lifecycle {
                WorkerLifecycle::Loading | WorkerLifecycle::Transcribing => {
                    return Err(AppError::engine_init_failed(
                        "worker is busy; wait for the current operation",
                    ));
                }
                _ => {}
            }
        }
        // Refuse to even try when RAM provably cannot fit the weights.
        if model.minimum_ram_gb > 0.0 {
            let available = sysinfo::System::new_all().available_memory();
            let need = (model.minimum_ram_gb * 1_000_000_000.0) as u64;
            if available < need {
                let message = format!(
                    "not enough free memory to load {} (need ~{:.0} GB, have ~{:.1} GB)",
                    model.id,
                    model.minimum_ram_gb,
                    available as f64 / 1_000_000_000.0
                );
                self.fail(&message);
                return Err(AppError::out_of_memory(message));
            }
        }
        self.set_lifecycle(WorkerLifecycle::Loading, Some(model.id.clone()), None);
        on_stage(LoadStage::ResolvingFiles);
        on_stage(LoadStage::CreatingEngine);
        match loader(model, dir) {
            Ok(engine) => {
                let mut inner = self
                    .inner
                    .lock()
                    .map_err(|_| AppError::engine_init_failed("worker state is unavailable"))?;
                inner.engine = Some(std::sync::Arc::new(Mutex::new(engine)));
                inner.lifecycle = WorkerLifecycle::Ready;
                inner.model_id = Some(model.id.clone());
                inner.failure = None;
                on_stage(LoadStage::Ready);
                Ok(())
            }
            Err(e) => {
                self.fail(&e.message);
                Err(e)
            }
        }
    }

    /// Drop the engine and free its memory. Always succeeds.
    pub fn unload(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.engine = None;
            inner.model_id = None;
            inner.failure = None;
            inner.lifecycle = WorkerLifecycle::Unloaded;
        }
    }

    /// Transcribe 16 kHz mono samples. Empty input short-circuits to an
    /// empty transcript without touching the engine. A first empty result
    /// is retried once (known Windows flake); a second empty result is a
    /// hard `inference-empty-result` error — empty text is never accepted
    /// silently. A panicking decode unloads the engine.
    pub async fn transcribe(
        &self,
        samples: &[f32],
        language: &str,
    ) -> Result<Transcript, AppError> {
        if samples.is_empty() {
            return Ok(Transcript::empty());
        }
        let engine = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::engine_init_failed("worker state is unavailable"))?;
            // Copy the (Copy) lifecycle out first so no borrow is held
            // across the mutation below.
            let lifecycle = inner.lifecycle;
            if lifecycle == WorkerLifecycle::Failed {
                let message = inner
                    .failure
                    .clone()
                    .unwrap_or_else(|| "worker is in a failed state".to_string());
                return Err(AppError::engine_init_failed(message));
            }
            let Some(engine) = inner.engine.clone() else {
                return Err(AppError::model_not_loaded(
                    "no local model is loaded; download and load one first",
                ));
            };
            if lifecycle != WorkerLifecycle::Ready && lifecycle != WorkerLifecycle::Transcribing {
                // Loading/Unloaded with a stale engine slot: refuse rather
                // than decode against a half-loaded model.
                return Err(AppError::model_not_loaded(
                    "no local model is loaded; download and load one first",
                ));
            }
            inner.lifecycle = WorkerLifecycle::Transcribing;
            engine
        };
        let language = normalize_language(language);
        let outcome = self.decode_with_retry(&engine, samples, &language).await;
        // Restore Ready unless something else moved the lifecycle meanwhile
        // (e.g. unload or a crash-unload during our decode).
        if let Ok(mut inner) = self.inner.lock() {
            if inner.lifecycle == WorkerLifecycle::Transcribing {
                inner.lifecycle = WorkerLifecycle::Ready;
            }
        }
        outcome
    }

    async fn decode_with_retry(
        &self,
        engine: &std::sync::Arc<Mutex<Box<dyn LocalTranscriber>>>,
        samples: &[f32],
        language: &str,
    ) -> Result<Transcript, AppError> {
        let audio_secs = samples.len() as f64 / f64::from(TARGET_SAMPLE_RATE);
        let transcript = self.decode_once(engine, samples, language).await?;
        if !transcript.text.trim().is_empty() {
            return Ok(transcript);
        }
        // One retry on empty (known Windows flake), then a hard error —
        // empty text is never accepted silently.
        let transcript = self.decode_once(engine, samples, language).await?;
        if transcript.text.trim().is_empty() {
            return Err(AppError::inference_empty_result(format!(
                "engine returned no text for {audio_secs:.1}s of audio; retry exhausted"
            )));
        }
        Ok(transcript)
    }

    /// Single decode with deadline. A panicking decode unloads the engine;
    /// a timed-out decode keeps running detached (its lock share is still
    /// held) while later calls queue behind it — documented limitation.
    async fn decode_once(
        &self,
        engine: &std::sync::Arc<Mutex<Box<dyn LocalTranscriber>>>,
        samples: &[f32],
        language: &str,
    ) -> Result<Transcript, AppError> {
        let engine = engine.clone();
        let owned: Vec<f32> = samples.to_vec();
        let lang = language.to_string();
        let decoded = tokio::time::timeout(
            self.transcribe_timeout,
            tokio::task::spawn_blocking(move || {
                engine
                    .lock()
                    .map_err(|_| AppError::engine_init_failed("transcriber lock is unavailable"))
                    .and_then(|engine| engine.transcribe(&owned, &lang))
            }),
        )
        .await;
        match decoded {
            Err(_) => Err(AppError::inference_timeout(format!(
                "local transcription timed out after {}s",
                self.transcribe_timeout.as_secs()
            ))),
            Ok(Err(join)) => {
                // The decode thread died: engine state is suspect, drop it.
                self.unload();
                let mut inner = self
                    .inner
                    .lock()
                    .map_err(|_| AppError::engine_init_failed("worker state is unavailable"))?;
                inner.lifecycle = WorkerLifecycle::Failed;
                inner.failure = Some("transcription worker crashed".to_string());
                Err(AppError::engine_init_failed(format!(
                    "transcription worker crashed: {join}"
                )))
            }
            Ok(Ok(result)) => result,
        }
    }

    fn set_lifecycle(
        &self,
        lifecycle: WorkerLifecycle,
        model_id: Option<String>,
        failure: Option<String>,
    ) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.lifecycle = lifecycle;
            inner.model_id = model_id;
            inner.failure = failure;
            if lifecycle != WorkerLifecycle::Ready {
                inner.engine = None;
            }
        }
    }

    fn fail(&self, message: &str) {
        self.set_lifecycle(WorkerLifecycle::Failed, None, Some(message.to_string()));
    }
}

impl Default for TranscriptionWorker {
    fn default() -> Self {
        Self::new()
    }
}

fn normalize_language(language: &str) -> String {
    match language.trim() {
        "" | "auto" => String::new(),
        other => other.to_string(),
    }
}

/// Engine file layout under a model dir (paths relative to it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineLayout {
    pub family: &'static str,
    pub files: Vec<PathBuf>,
}

/// Resolve every file the engine will open, for preflight checks and UI.
/// Pure function of manifest + dir (no I/O beyond path joins).
pub fn engine_layout(model: &LocalModel) -> Result<EngineLayout, AppError> {
    let family = resolve_sherpa_family(model)?;
    let names: Vec<String> = match &family {
        SherpaFamily::Transducer {
            encoder,
            decoder,
            joiner,
            tokens,
        } => vec![
            encoder.clone(),
            decoder.clone(),
            joiner.clone(),
            tokens.clone(),
        ],
        SherpaFamily::Whisper {
            encoder,
            decoder,
            tokens,
        } => vec![encoder.clone(), decoder.clone(), tokens.clone()],
        SherpaFamily::Qwen3 {
            frontend,
            encoder,
            decoder,
            tokenizer_dir,
        } => vec![
            frontend.clone(),
            encoder.clone(),
            decoder.clone(),
            format!("{tokenizer_dir}/vocab.json"),
        ],
    };
    let label = match family {
        SherpaFamily::Transducer { .. } => "parakeet-transducer",
        SherpaFamily::Whisper { .. } => "whisper",
        SherpaFamily::Qwen3 { .. } => "qwen3-asr",
    };
    Ok(EngineLayout {
        family: label,
        files: names.into_iter().map(PathBuf::from).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_asr::manifest::{default_manifest, validate_manifest, ModelEngine};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn parakeet_model() -> LocalModel {
        let manifest = default_manifest().expect("manifest");
        validate_manifest(&manifest).expect("valid");
        manifest
            .models
            .into_iter()
            .find(|m| m.id == "parakeet-tdt-0.6b-v3")
            .expect("parakeet")
    }

    fn test_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "algorith-voice-workertest-{}-{}-{}",
            std::process::id(),
            n,
            name
        ))
    }

    #[derive(Clone)]
    enum FakeBehavior {
        Text(String),
        EmptyAlways,
        EmptyOnceThenText(String),
        SleepForever,
        Panic,
    }

    struct FakeTranscriber {
        id: String,
        behavior: Mutex<FakeBehavior>,
    }

    impl FakeTranscriber {
        fn new(behavior: FakeBehavior) -> Self {
            Self {
                id: "fake-model".to_string(),
                behavior: Mutex::new(behavior),
            }
        }
    }

    impl LocalTranscriber for FakeTranscriber {
        fn model_id(&self) -> &str {
            &self.id
        }

        fn transcribe(&self, samples: &[f32], language: &str) -> Result<Transcript, AppError> {
            let mut behavior = self.behavior.lock().expect("fake lock");
            let language = match normalize_language(language).as_str() {
                "" => None,
                other => Some(other.to_string()),
            };
            let done = |text: String| Transcript {
                segments: vec![TranscriptSegment {
                    start_secs: 0.0,
                    end_secs: samples.len() as f64 / f64::from(TARGET_SAMPLE_RATE),
                    text: text.clone(),
                }],
                text,
                language: language.clone(),
            };
            match behavior.clone() {
                FakeBehavior::Text(text) => Ok(done(text)),
                FakeBehavior::EmptyAlways => Ok(done(String::new())),
                FakeBehavior::EmptyOnceThenText(text) => {
                    *behavior = FakeBehavior::Text(text.clone());
                    Ok(done(String::new()))
                }
                FakeBehavior::SleepForever => {
                    std::thread::sleep(Duration::from_millis(300));
                    Ok(done("too late".to_string()))
                }
                FakeBehavior::Panic => panic!("fake worker boom"),
            }
        }
    }

    fn load_fake(worker: &TranscriptionWorker, behavior: FakeBehavior) -> Result<(), AppError> {
        let model = parakeet_model();
        worker.load_with(
            &model,
            Path::new("."),
            |_| {},
            |_, _| Ok(Box::new(FakeTranscriber::new(behavior)) as Box<dyn LocalTranscriber>),
        )
    }

    fn samples_1s() -> Vec<f32> {
        vec![0.1f32; TARGET_SAMPLE_RATE as usize]
    }

    #[test]
    fn load_unload_lifecycle() {
        let worker = TranscriptionWorker::default();
        assert_eq!(worker.status().lifecycle, WorkerLifecycle::Unloaded);
        load_fake(&worker, FakeBehavior::Text("hi".to_string())).expect("load");
        let status = worker.status();
        assert_eq!(status.lifecycle, WorkerLifecycle::Ready);
        assert_eq!(status.model_id.as_deref(), Some("parakeet-tdt-0.6b-v3"));
        worker.unload();
        assert_eq!(worker.status().lifecycle, WorkerLifecycle::Unloaded);
    }

    #[tokio::test]
    async fn transcribe_success_reports_full_utterance() {
        let worker = TranscriptionWorker::new();
        load_fake(&worker, FakeBehavior::Text("hello world".to_string())).expect("load");
        let t = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect("transcribes");
        assert_eq!(t.text, "hello world");
        assert_eq!(t.segments.len(), 1);
        assert_eq!(t.segments[0].start_secs, 0.0);
        assert!((t.segments[0].end_secs - 1.0).abs() < 1e-9);
        assert_eq!(t.language.as_deref(), Some("en"));
        assert_eq!(worker.status().lifecycle, WorkerLifecycle::Ready);
    }

    #[tokio::test]
    async fn empty_input_short_circuits_without_engine() {
        let worker = TranscriptionWorker::new(); // never loaded
        let t = worker.transcribe(&[], "en").await.expect("empty ok");
        assert_eq!(t.text, "");
        assert!(t.segments.is_empty());
    }

    #[tokio::test]
    async fn transcribe_without_model_is_not_loaded() {
        let worker = TranscriptionWorker::new();
        let err = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect_err("needs a model");
        assert_eq!(err.code, "model-not-loaded");
    }

    #[tokio::test]
    async fn empty_result_retries_once_then_fails_loudly() {
        let worker = TranscriptionWorker::new();
        load_fake(
            &worker,
            FakeBehavior::EmptyOnceThenText("recovered".to_string()),
        )
        .expect("load");
        let t = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect("retry recovers");
        assert_eq!(t.text, "recovered");

        let worker = TranscriptionWorker::new();
        load_fake(&worker, FakeBehavior::EmptyAlways).expect("load");
        let err = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect_err("must not accept empty");
        assert_eq!(err.code, "inference-empty-result");
    }

    #[tokio::test]
    async fn slow_decode_hits_the_deadline() {
        let worker = TranscriptionWorker::with_timeout(Duration::from_millis(50));
        load_fake(&worker, FakeBehavior::SleepForever).expect("load");
        let err = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect_err("must time out");
        assert_eq!(err.code, "inference-timeout");
    }

    #[tokio::test]
    async fn panicking_decode_unloads_and_fails() {
        let worker = TranscriptionWorker::new();
        load_fake(&worker, FakeBehavior::Panic).expect("load");
        let err = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect_err("panic surfaces");
        assert_eq!(err.code, "engine-init-failed");
        assert_eq!(worker.status().lifecycle, WorkerLifecycle::Failed);
        // Failed workers refuse further work until unload/reload.
        let err = worker
            .transcribe(&samples_1s(), "en")
            .await
            .expect_err("failed stays failed");
        assert_eq!(err.code, "engine-init-failed");
    }

    #[test]
    fn concurrent_loads_cannot_double_load() {
        use std::sync::Arc;
        let worker = Arc::new(TranscriptionWorker::new());
        let (entered_tx, entered_rx) = std::sync::mpsc::channel::<()>();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        // Each channel half is owned by exactly one thread (the std mpsc
        // Receiver is Send but not Sync, so nothing is shared by reference).
        // entered/release pair already synchronizes both sides; no barrier
        // needed (a 2-party barrier with one waiter would deadlock).
        let handle = std::thread::spawn({
            let worker = worker.clone();
            move || {
                let mut model = parakeet_model();
                model.id = "fake-model".to_string();
                worker.load_with(
                    &model,
                    Path::new("."),
                    |_| {},
                    |_, _| {
                        let _ = entered_tx.send(());
                        release_rx.recv().expect("release");
                        Ok(
                            Box::new(FakeTranscriber::new(FakeBehavior::Text("x".to_string())))
                                as Box<dyn LocalTranscriber>,
                        )
                    },
                )
            }
        });
        // Wait until the first load is inside its loader, then attempt a
        // second load: it must be refused as busy, not deadlock.
        entered_rx.recv().expect("first loader entered");
        let mut model = parakeet_model();
        model.id = "fake-model".to_string();
        let err = worker
            .load_with(
                &model,
                Path::new("."),
                |_| {},
                |_, _| panic!("second loader must never run"),
            )
            .expect_err("busy worker refuses second load");
        assert_eq!(err.code, "engine-init-failed");
        release_tx.send(()).expect("release first");
        handle.join().expect("first thread").expect("first load ok");
        assert_eq!(worker.status().lifecycle, WorkerLifecycle::Ready);
    }

    #[test]
    fn absurd_ram_demand_fails_fast_with_oom_code() {
        let worker = TranscriptionWorker::new();
        let mut model = parakeet_model();
        model.id = "fake-model".to_string();
        model.minimum_ram_gb = 1e12;
        let err = worker
            .load_with(
                &model,
                Path::new("."),
                |_| {},
                |_, _| panic!("loader must never run without RAM"),
            )
            .expect_err("impossible RAM fails");
        assert_eq!(err.code, "out-of-memory");
        assert_eq!(worker.status().lifecycle, WorkerLifecycle::Failed);
    }

    #[test]
    fn family_dispatch_by_filename() {
        let mut model = parakeet_model();
        // Parakeet bundle layout from the manifest template.
        assert!(matches!(
            resolve_sherpa_family(&model),
            Ok(SherpaFamily::Transducer { .. })
        ));
        // Drop the joiner: falls back to whisper dispatch, which then
        // reports the missing decoder/tokens for this fixture.
        model.files.retain(|f| !f.filename.contains("joiner"));
        let err = resolve_sherpa_family(&model).expect_err("joiner-less parakeet is incomplete");
        assert_eq!(err.code, "engine-init-failed");

        // Whisper layout from the manifest template.
        let manifest = default_manifest().expect("manifest");
        let whisper = manifest
            .models
            .iter()
            .find(|m| m.id == "whisper-small")
            .expect("whisper entry");
        assert!(matches!(
            resolve_sherpa_family(whisper),
            Ok(SherpaFamily::Whisper { .. })
        ));

        // Qwen3 layout from the manifest template.
        let qwen = manifest
            .models
            .iter()
            .find(|m| m.id == "qwen3-asr-1.7b")
            .expect("qwen entry");
        assert!(matches!(
            resolve_sherpa_family(qwen),
            Ok(SherpaFamily::Qwen3 { .. })
        ));

        // Non-sherpa engines are refused with a clear, actionable error.
        let mut other = parakeet_model();
        other.engine = ModelEngine::WhisperCpp;
        let err = resolve_sherpa_family(&other).expect_err("whisper-cpp is not bundled");
        assert_eq!(err.code, "engine-init-failed");

        // Engine layout preflight lists every file the loader will open.
        let layout = engine_layout(&parakeet_model()).expect("layout");
        assert_eq!(layout.family, "parakeet-transducer");
        assert_eq!(layout.files.len(), 4);
    }

    #[test]
    fn sherpa_load_rejects_missing_files_without_weights() {
        // Empty model dir: the loader must fail naming the gap, without
        // ever constructing the engine (no weights needed for this).
        let dir = test_dir("missing-files");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let model = parakeet_model();
        let err = SherpaTranscriber::load(&model, &dir).expect_err("missing files fail");
        assert_eq!(err.code, "engine-init-failed");
        assert!(
            err.message.contains("encoder"),
            "names the gap: {}",
            err.message
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gated_real_model_smoke() {
        // Full worker path against the real INT8 bundle when present
        // (same fixture convention as tests/spike_parakeet.rs). Uses a
        // single-threaded runtime: load is synchronous blocking anyway.
        let dir = match std::env::var("SHERPA_PARAKEET_MODEL_DIR") {
            Ok(d) if Path::new(&d).is_dir() => PathBuf::from(d),
            _ => {
                eprintln!("SKIPPED worker gated test: set SHERPA_PARAKEET_MODEL_DIR");
                return;
            }
        };
        let model = parakeet_model();
        let worker = TranscriptionWorker::with_timeout(Duration::from_secs(120));
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        rt.block_on(async {
            worker.load(&model, &dir, |_| {}).expect("real load");
            assert_eq!(worker.status().lifecycle, WorkerLifecycle::Ready);
            let wav_path = std::env::var("SHERPA_TEST_WAV")
                .map(PathBuf::from)
                .unwrap_or_else(|_| dir.join("test_wavs").join("en.wav"));
            let wave = sherpa_onnx::Wave::read(wav_path.to_str().expect("utf8 path"))
                .expect("fixture wav parses");
            let transcript = worker
                .transcribe(wave.samples(), "auto")
                .await
                .expect("real model transcribes");
            assert!(
                !transcript.text.trim().is_empty(),
                "real model must produce text"
            );
            worker.unload();
            assert_eq!(worker.status().lifecycle, WorkerLifecycle::Unloaded);
        });
    }
}
