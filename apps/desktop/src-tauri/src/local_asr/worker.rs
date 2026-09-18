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
    /// Decode 16 kHz mono samples. Blocking. `language` is BCP-47-ish or
    /// `"auto"`; engines that select a language at load time must have been
    /// (re)built for it by the caller (see `supports_language_selection`).
    fn transcribe(&self, samples: &[f32], language: &str) -> Result<Transcript, AppError>;
    /// Effective language baked into this engine (`None` = auto-detect).
    /// The worker snapshots it at load for lazy language switching.
    fn language(&self) -> Option<&str> {
        None
    }
    /// True when the engine honors per-request languages by rebuilding
    /// (Whisper bakes `language` into the recognizer at creation).
    /// Transducer/Qwen3-style multilingual engines return false: one load
    /// serves every language, so callers must not reload on language change.
    fn supports_language_selection(&self) -> bool {
        false
    }
    /// Execution provider the engine actually runs on (`"cpu"`, `"cuda"`).
    fn provider(&self) -> &str {
        "cpu"
    }
}

/// Which Sherpa model family a manifest entry maps to, derived from its
/// listed filenames (encoder/decoder/joiner vs whisper pair vs Qwen3
/// frontend). Pure function of the manifest — no disk access.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SherpaFamily {
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

fn find_file(model: &LocalModel, mut matches: impl FnMut(&str) -> bool) -> Option<&str> {
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
    /// Effective language baked into the recognizer (`None` = auto-detect).
    language: Option<String>,
    /// True only for Whisper: the only family that bakes a language in.
    selects_language: bool,
    /// Provider the recognizer actually runs on (`"cpu"` or `"cuda"`).
    provider: String,
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
    ///
    /// `language` is BCP-47-ish (`"uz"`, `"en"`) or `"auto"`/empty. Whisper
    /// bakes it into the recognizer at creation: a non-auto request for an
    /// unsupported language is refused loudly, never silently auto-detected.
    /// Transducer/Qwen3 engines are multilingual per load, so the language
    /// is metadata-only for them.
    pub fn load(model: &LocalModel, dir: &Path, language: &str) -> Result<Self, AppError> {
        let family = resolve_sherpa_family(model)?;
        let selects_language = matches!(family, SherpaFamily::Whisper { .. });
        let want = normalize_language(language);
        // Cloned, not moved: `want` below becomes the recognizer's language
        // verbatim (`Some("")` = auto-detect, exactly the old behavior).
        let want_opt = if want.is_empty() {
            None
        } else {
            Some(want.clone())
        };
        if let (Some(lang), SherpaFamily::Whisper { .. }) = (want_opt.as_deref(), &family) {
            if !model.languages.is_empty()
                && !model.languages.iter().any(|l| l.eq_ignore_ascii_case(lang))
            {
                return Err(AppError::model_incompatible(format!(
                    "model {} does not support language '{lang}'; supported: {}",
                    model.id,
                    model.languages.join(", ")
                )));
            }
        }
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
                // The language is baked into the recognizer at creation:
                // empty = auto-detect (upstream sherpa behavior), otherwise
                // the decoder is forced to that language (validated above).
                config.model_config.whisper = sherpa_onnx::OfflineWhisperModelConfig {
                    encoder: Some(join(dir, &encoder)),
                    decoder: Some(join(dir, &decoder)),
                    language: Some(want),
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
        config.model_config.debug = false;
        // Prefer CUDA when an NVIDIA GPU is present; fall back to CPU when
        // the linked ONNX Runtime has no CUDA execution provider (creation
        // fails fast, before any weights load) or the GPU run fails.
        // The effective provider is recorded and reported in status.
        let mut provider = select_provider();
        config.model_config.provider = Some(provider.clone());
        let mut recognizer = sherpa_onnx::OfflineRecognizer::create(&config);
        if recognizer.is_none() && provider != "cpu" {
            provider = "cpu".to_string();
            config.model_config.provider = Some(provider.clone());
            recognizer = sherpa_onnx::OfflineRecognizer::create(&config);
        }
        let recognizer = recognizer.ok_or_else(|| {
            AppError::engine_init_failed(format!(
                "sherpa could not initialise model {} (bad weights or unsupported hardware)",
                model.id
            ))
        })?;
        // Only Whisper bakes the language in; other families serve every
        // language from one load. (`family` was consumed by the config
        // match above, so the precomputed flag decides here.)
        let effective_language = if selects_language { want_opt } else { None };
        Ok(Self {
            model_id: model.id.clone(),
            recognizer,
            language: effective_language,
            selects_language,
            provider,
        })
    }
}

/// Execution provider preference for a fresh load: CUDA when an NVIDIA GPU
/// is detectable, CPU otherwise. Creation failure still falls back to CPU
/// (see `load`), so a CPU-only ONNX Runtime build never breaks loading.
fn select_provider() -> String {
    if crate::local_asr::hardware::has_nvidia_gpu() {
        "cuda".to_string()
    } else {
        "cpu".to_string()
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

    fn language(&self) -> Option<&str> {
        self.language.as_deref()
    }

    fn supports_language_selection(&self) -> bool {
        // Only Whisper bakes a language into the recognizer; transducer and
        // Qwen3 loads serve every language.
        self.selects_language
    }

    fn provider(&self) -> &str {
        &self.provider
    }

    fn transcribe(&self, samples: &[f32], _language: &str) -> Result<Transcript, AppError> {
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
        // Report the language the engine actually ran with — never echo the
        // request: in auto mode sherpa detects per utterance and exposes no
        // detected tag, so `None` is the honest answer.
        let effective = self.language.clone();
        Ok(Transcript {
            segments: vec![TranscriptSegment {
                start_secs: 0.0,
                end_secs: duration,
                text: text.clone(),
            }],
            text,
            language: effective,
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
    /// Execution provider of the loaded engine (`"cpu"`/`"cuda"`), if any.
    pub provider: Option<String>,
    /// Effective language of the loaded engine (`None` = auto-detect), if any.
    pub language: Option<String>,
}

struct WorkerInner {
    lifecycle: WorkerLifecycle,
    engine: Option<std::sync::Arc<Mutex<Box<dyn LocalTranscriber>>>>,
    model_id: Option<String>,
    failure: Option<String>,
    /// Snapshots taken at load so status/language checks never lock the
    /// engine mutex (which a running decode holds for its whole duration).
    loaded_provider: Option<String>,
    loaded_language: Option<String>,
    language_selective: bool,
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
                loaded_provider: None,
                loaded_language: None,
                language_selective: false,
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
                provider: inner.loaded_provider.clone(),
                language: inner.loaded_language.clone(),
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
                    provider: inner.loaded_provider.clone(),
                    language: inner.loaded_language.clone(),
                }
            }
        }
    }

    /// True when exactly `model_id` is loaded and ready to decode.
    /// Cheap lock read for lazy-switch checks; never blocks on inference.
    pub fn is_ready_for(&self, model_id: &str) -> bool {
        self.inner
            .lock()
            .map(|inner| {
                inner.lifecycle == WorkerLifecycle::Ready
                    && inner.model_id.as_deref() == Some(model_id)
            })
            .unwrap_or(false)
    }

    /// True when the worker holds `model_id` ready but its baked-in language
    /// differs from `want` (`None` = auto). Only ever true for selective
    /// engines (Whisper): multilingual engines serve every language from one
    /// load, so callers must not reload for them. Cheap lock read.
    pub fn language_mismatch(&self, model_id: &str, want: Option<&str>) -> bool {
        self.inner
            .lock()
            .map(|inner| {
                inner.lifecycle == WorkerLifecycle::Ready
                    && inner.model_id.as_deref() == Some(model_id)
                    && inner.language_selective
                    && inner.loaded_language.as_deref() != want
            })
            .unwrap_or(false)
    }

    /// Load a model with the production Sherpa loader (auto-detect
    /// language). Blocking — callers must move it off the async executor
    /// (spawn_blocking at the command layer, as with clipboard paste).
    pub fn load(
        &self,
        model: &LocalModel,
        dir: &Path,
        on_stage: impl Fn(LoadStage),
    ) -> Result<(), AppError> {
        self.load_in(model, dir, "", on_stage)
    }

    /// Load with an explicit language (`"uz"`, `"en"`, `"auto"`/empty).
    /// Whisper bakes it into the recognizer; other families ignore it.
    pub fn load_in(
        &self,
        model: &LocalModel,
        dir: &Path,
        language: &str,
        on_stage: impl Fn(LoadStage),
    ) -> Result<(), AppError> {
        self.load_with(model, dir, on_stage, |model, dir| {
            Ok(Box::new(SherpaTranscriber::load(model, dir, language)?)
                as Box<dyn LocalTranscriber>)
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
        if model.min_ram_gb > 0.0 {
            let available = sysinfo::System::new_all().available_memory();
            let need = (model.min_ram_gb * 1_000_000_000.0) as u64;
            if available < need {
                let message = format!(
                    "not enough free memory to load {} (need ~{:.0} GB, have ~{:.1} GB)",
                    model.id,
                    model.min_ram_gb,
                    available as f64 / 1_000_000_000.0
                );
                self.fail(&message);
                return Err(AppError::out_of_memory(message));
            }
        }
        // Re-verify file integrity before touching the engine (defense-in-depth:
        // downloader verified before rename, but a later symlink/file swap or
        // disk corruption must not reach the ONNX parser). Blocking, so caller
        // must be off the async executor (commands.rs uses spawn_blocking).
        verify_model_files(model, dir).inspect_err(|e| {
            self.fail(&e.message);
        })?;
        self.set_lifecycle(WorkerLifecycle::Loading, Some(model.id.clone()), None);
        on_stage(LoadStage::ResolvingFiles);
        on_stage(LoadStage::CreatingEngine);
        match loader(model, dir) {
            Ok(engine) => {
                // Snapshot engine traits before the move: powers status()
                // and lazy language switching without locking the engine.
                let loaded_provider = engine.provider().to_owned();
                let loaded_language = engine.language().map(str::to_owned);
                let language_selective = engine.supports_language_selection();
                let mut inner = self
                    .inner
                    .lock()
                    .map_err(|_| AppError::engine_init_failed("worker state is unavailable"))?;
                inner.engine = Some(std::sync::Arc::new(Mutex::new(engine)));
                inner.lifecycle = WorkerLifecycle::Ready;
                inner.model_id = Some(model.id.clone());
                inner.failure = None;
                inner.loaded_provider = Some(loaded_provider);
                inner.loaded_language = loaded_language;
                inner.language_selective = language_selective;
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
            inner.loaded_provider = None;
            inner.loaded_language = None;
            inner.language_selective = false;
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
                inner.loaded_provider = None;
                inner.loaded_language = None;
                inner.language_selective = false;
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

/// Normalize a requested language to the engine's canonical form: `""`
/// for auto-detect, otherwise a lowercased bare ISO code (`"en-US"` →
/// `"en"`). Shared with the PTT path so the lazy-switch check and the
/// loader agree on what "same language" means.
pub(crate) fn normalize_language(language: &str) -> String {
    // Lowercased bare code: whisper language tokens and manifest codes are
    // lowercase ISO codes, so `"EN"`, `"en-US"` and `"en"` select the same
    // load instead of failing on casing or region suffixes.
    match language.trim() {
        "" | "auto" => String::new(),
        other => other
            .split(['-', '_'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase(),
    }
}

fn verify_model_files(model: &LocalModel, dir: &Path) -> Result<(), AppError> {
    use sha2::{Digest, Sha256};
    use std::fs::File;
    use std::io::Read;
    for file in &model.files {
        let path = dir.join(&file.filename);
        // Must be a regular file (not symlink-followed dir traversal already blocked by manifest,
        // but double-check here to avoid loading through a symlink planted after download).
        let meta = std::fs::symlink_metadata(&path).map_err(|_| {
            AppError::engine_init_failed(format!(
                "model {} is missing its {} file; re-download the model",
                model.id, file.filename
            ))
        })?;
        if meta.file_type().is_symlink() {
            return Err(AppError::engine_init_failed(format!(
                "model {} file {} is a symlink — refusing to load; re-download",
                model.id, file.filename
            )));
        }
        if !meta.is_file() {
            return Err(AppError::engine_init_failed(format!(
                "model {} is missing its {} file; re-download the model",
                model.id, file.filename
            )));
        }
        if file.size_bytes != 0 && meta.len() != file.size_bytes {
            return Err(AppError::engine_init_failed(format!(
                "model {} file {} size mismatch (expected {}, got {}); re-download or verify",
                model.id,
                file.filename,
                file.size_bytes,
                meta.len()
            )));
        }
        // Hash check (blocking). Large files (100MB-1GB) are hashed here once per load;
        // load is already spawn_blocking, so this does not block the async runtime.
        let mut f = File::open(&path).map_err(|e| {
            AppError::engine_init_failed(format!(
                "cannot open model {} file {}: {e}",
                model.id, file.filename
            ))
        })?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = f.read(&mut buf).map_err(|e| {
                AppError::engine_init_failed(format!(
                    "cannot read model {} file {}: {e}",
                    model.id, file.filename
                ))
            })?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        let actual = format!("{:x}", hasher.finalize());
        if actual.to_lowercase() != file.sha256.to_lowercase() {
            return Err(AppError::engine_init_failed(format!(
                "model {} file {} checksum mismatch; re-download or verify the model",
                model.id, file.filename
            )));
        }
    }
    Ok(())
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
        lang: Option<String>,
        selective: bool,
    }

    impl FakeTranscriber {
        fn new(behavior: FakeBehavior) -> Self {
            Self {
                id: "fake-model".to_string(),
                behavior: Mutex::new(behavior),
                lang: None,
                selective: false,
            }
        }

        fn selective(behavior: FakeBehavior, lang: Option<&str>) -> Self {
            Self {
                id: "fake-model".to_string(),
                behavior: Mutex::new(behavior),
                lang: lang.map(str::to_owned),
                selective: true,
            }
        }
    }

    impl LocalTranscriber for FakeTranscriber {
        fn model_id(&self) -> &str {
            &self.id
        }

        fn language(&self) -> Option<&str> {
            self.lang.as_deref()
        }

        fn supports_language_selection(&self) -> bool {
            self.selective
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

    fn load_selective_fake(
        worker: &TranscriptionWorker,
        lang: Option<&str>,
    ) -> Result<(), AppError> {
        let model = parakeet_model();
        worker.load_with(
            &model,
            Path::new("."),
            |_| {},
            |_, _| {
                Ok(Box::new(FakeTranscriber::selective(
                    FakeBehavior::Text("x".to_string()),
                    lang,
                )) as Box<dyn LocalTranscriber>)
            },
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
        model.min_ram_gb = 1e12;
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
        // Drop the joiner from the manifest: the set is now whisper-shaped
        // (encoder + decoder + tokens), so dispatch falls back to Whisper by
        // design. A joiner file missing *on disk* is a different case and is
        // still reported by name (see the missing-files test below).
        model.files.retain(|f| !f.filename.contains("joiner"));
        assert!(matches!(
            resolve_sherpa_family(&model),
            Ok(SherpaFamily::Whisper { .. })
        ));

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
        let err = SherpaTranscriber::load(&model, &dir, "auto").expect_err("missing files fail");
        assert_eq!(err.code, "engine-init-failed");
        assert!(
            err.message.contains("encoder"),
            "names the gap: {}",
            err.message
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalize_language_canonicalizes_request() {
        assert_eq!(normalize_language(""), "");
        assert_eq!(normalize_language("auto"), "");
        assert_eq!(normalize_language("  auto  "), "");
        assert_eq!(normalize_language("en"), "en");
        assert_eq!(normalize_language("EN"), "en");
        assert_eq!(normalize_language("en-US"), "en");
        assert_eq!(normalize_language("uz"), "uz");
    }

    #[test]
    fn whisper_load_refuses_unsupported_language_loudly() {
        // Language validation runs before any file access: no weights
        // needed, and the error names the supported set (never silent auto).
        let manifest = default_manifest().expect("manifest");
        let whisper = manifest
            .models
            .iter()
            .find(|m| m.id == "whisper-small")
            .expect("whisper entry");
        let dir = test_dir("bad-language");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let err = SherpaTranscriber::load(whisper, &dir, "xx").expect_err("unsupported lang fails");
        assert_eq!(err.code, "model-incompatible");
        assert!(
            err.message.contains("'xx'"),
            "names the request: {}",
            err.message
        );
        assert!(
            err.message.contains("whisper-small"),
            "names the model: {}",
            err.message
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn language_mismatch_only_fires_for_selective_engines() {
        // Non-selective (transducer-style) engine: every language matches.
        let worker = TranscriptionWorker::new();
        load_fake(&worker, FakeBehavior::Text("x".to_string())).expect("load");
        assert!(!worker.language_mismatch("parakeet-tdt-0.6b-v3", Some("en")));
        assert!(!worker.language_mismatch("parakeet-tdt-0.6b-v3", Some("uz")));
        assert!(!worker.language_mismatch("parakeet-tdt-0.6b-v3", None));
        assert!(!worker.language_mismatch("other-model", Some("en")));

        // Selective (whisper-style) engine baked for "en".
        let worker = TranscriptionWorker::new();
        load_selective_fake(&worker, Some("en")).expect("load");
        assert!(!worker.language_mismatch("parakeet-tdt-0.6b-v3", Some("en")));
        assert!(worker.language_mismatch("parakeet-tdt-0.6b-v3", Some("uz")));
        assert!(worker.language_mismatch("parakeet-tdt-0.6b-v3", None));

        // Selective engine in auto mode only matches auto.
        let worker = TranscriptionWorker::new();
        load_selective_fake(&worker, None).expect("load");
        assert!(!worker.language_mismatch("parakeet-tdt-0.6b-v3", None));
        assert!(worker.language_mismatch("parakeet-tdt-0.6b-v3", Some("en")));
    }

    #[test]
    fn status_snapshots_provider_and_language() {
        let worker = TranscriptionWorker::new();
        let empty = worker.status();
        assert_eq!(empty.provider, None);
        assert_eq!(empty.language, None);
        load_selective_fake(&worker, Some("uz")).expect("load");
        let ready = worker.status();
        assert_eq!(ready.provider.as_deref(), Some("cpu"));
        assert_eq!(ready.language.as_deref(), Some("uz"));
        worker.unload();
        let cleared = worker.status();
        assert_eq!(cleared.provider, None);
        assert_eq!(cleared.language, None);
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
