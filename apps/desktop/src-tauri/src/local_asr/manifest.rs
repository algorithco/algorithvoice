//! Versioned model manifest: parsing, validation, platform matching.
//!
//! The manifest describes every downloadable local model: its engine,
//! files (URLs + SHA-256 + sizes), hardware expectations, license and
//! attribution. Shape validation lives here; transport trust does not —
//! every file is re-verified by hash after download regardless of source.
//!
//! The bundled [`default_manifest`] is a template: URLs and checksums are
//! clearly-marked `REPLACE-WITH-*` placeholders until the operator
//! configures a model CDN. [`is_configured`] distinguishes the two states
//! so downloads fail fast with a clear message instead of a DNS error.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// Manifest schema version understood by this build.
pub const MANIFEST_VERSION: u32 = 1;

/// Local inference engine backing a model. Extended when new engines land
/// (e.g. a future Whisper.cpp runtime) without touching call sites.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelEngine {
    #[serde(rename = "sherpa-onnx")]
    SherpaOnnx,
    #[serde(rename = "whisper-cpp")]
    WhisperCpp,
}

/// Operating systems a model build supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelOs {
    #[serde(rename = "windows")]
    Windows,
    #[serde(rename = "macos")]
    Macos,
    #[serde(rename = "linux")]
    Linux,
}

/// CPU architectures a model build supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelArch {
    #[serde(rename = "x64")]
    X64,
    #[serde(rename = "arm64")]
    Arm64,
}

/// One downloadable file. `size_bytes == 0` means "unknown until download"
/// (progress then reports bytes + speed without a percentage).
///
/// Wire format is camelCase to match `packages/shared-types` exactly —
/// the embedded template below uses the same keys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub filename: String,
    pub url: String,
    pub fallback_url: Option<String>,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub id: String,
    pub name: String,
    pub version: String,
    pub engine: ModelEngine,
    pub quantization: String,
    pub files: Vec<ModelFile>,
    pub languages: Vec<String>,
    pub min_ram_gb: f64,
    pub recommended_ram_gb: f64,
    pub min_vram_gb: f64,
    pub recommended_vram_gb: f64,
    pub license: String,
    pub attribution: String,
    pub supported_os: Vec<ModelOs>,
    pub supported_arch: Vec<ModelArch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifest {
    pub manifest_version: u32,
    pub models: Vec<LocalModel>,
}

/// The manifest baked into the binary. Template values until configured.
pub fn default_manifest() -> AppResult<ModelManifest> {
    const JSON: &str = include_str!("default_manifest.json");
    serde_json::from_str(JSON).map_err(|e| {
        // Embedded manifest is validated by unit tests; failure here means
        // the build shipped a broken template, which is a packaging bug.
        AppError::internal(format!("bundled model manifest is invalid: {e}"))
    })
}

/// True when every URL is real (no `REPLACE-WITH-*` placeholders) and no
/// checksum is the all-zeros placeholder. Downloads are gated on this.
pub fn is_configured(model: &LocalModel) -> bool {
    const PLACEHOLDER_HOST: &str = "REPLACE-WITH-";
    const PLACEHOLDER_SHA: &str =
        "0000000000000000000000000000000000000000000000000000000000000000";
    model.files.iter().all(|f| {
        !f.url.contains(PLACEHOLDER_HOST)
            && f.fallback_url
                .as_deref()
                .is_none_or(|u| !u.contains(PLACEHOLDER_HOST))
            && f.sha256 != PLACEHOLDER_SHA
    })
}

/// The OS this binary is running on, in manifest terms.
pub fn current_os() -> ModelOs {
    match std::env::consts::OS {
        "macos" => ModelOs::Macos,
        "linux" => ModelOs::Linux,
        _ => ModelOs::Windows,
    }
}

/// The CPU architecture this binary is running on, in manifest terms.
pub fn current_arch() -> ModelArch {
    match std::env::consts::ARCH {
        "aarch64" => ModelArch::Arm64,
        _ => ModelArch::X64,
    }
}

impl LocalModel {
    /// Whether this model build supports the current OS/arch.
    pub fn supports_current_platform(&self) -> bool {
        let os = current_os();
        let arch = current_arch();
        self.supported_os.contains(&os) && self.supported_arch.contains(&arch)
    }

    /// Sum of *known* file sizes. Files with `size_bytes == 0` contribute
    /// nothing; see [`ModelManifest`] docs for unknown-size handling.
    pub fn known_total_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size_bytes).sum()
    }
}

/// Shape + security validation for a manifest: version support, unique ids,
/// safe slugs/versions/filenames, HTTPS-only transport, checksum shape,
/// hardware-field sanity. Transport trust is NOT established here — hashes
/// are verified after download.
pub fn validate_manifest(manifest: &ModelManifest) -> AppResult<()> {
    if manifest.manifest_version != MANIFEST_VERSION {
        return Err(AppError::internal(format!(
            "unsupported model manifest version {}, this build understands {}",
            manifest.manifest_version, MANIFEST_VERSION
        )));
    }
    if manifest.models.is_empty() {
        return Err(AppError::internal(
            "model manifest contains no models".to_string(),
        ));
    }
    let mut ids = std::collections::HashSet::new();
    for model in &manifest.models {
        if !ids.insert(model.id.as_str()) {
            return Err(AppError::internal(format!(
                "duplicate model id: {}",
                model.id
            )));
        }
        validate_model(model)?;
    }
    Ok(())
}

fn validate_model(model: &LocalModel) -> AppResult<()> {
    if !is_safe_slug(&model.id) {
        return Err(AppError::internal(format!(
            "model id is not a safe slug: {}",
            model.id
        )));
    }
    if model.name.trim().is_empty() || model.name.len() > 120 {
        return Err(AppError::internal(format!(
            "model {} has an invalid display name",
            model.id
        )));
    }
    if !is_semver(&model.version) {
        return Err(AppError::internal(format!(
            "model {} version is not semver x.y.z: {}",
            model.id, model.version
        )));
    }
    if model.quantization.trim().is_empty() || model.quantization.len() > 32 {
        return Err(AppError::internal(format!(
            "model {} has an invalid quantization label",
            model.id
        )));
    }
    if model.files.is_empty() {
        return Err(AppError::internal(format!(
            "model {} lists no files",
            model.id
        )));
    }
    let mut names = std::collections::HashSet::new();
    for file in &model.files {
        if !names.insert(file.filename.as_str()) {
            return Err(AppError::internal(format!(
                "model {} has a duplicate filename: {}",
                model.id, file.filename
            )));
        }
        validate_filename(&model.id, &file.filename)?;
        validate_https_url(&model.id, &file.url)?;
        if let Some(fallback) = file.fallback_url.as_deref() {
            validate_https_url(&model.id, fallback)?;
        }
        if !is_sha256(&file.sha256) {
            return Err(AppError::internal(format!(
                "model {} file {} has a malformed sha256",
                model.id, file.filename
            )));
        }
    }
    if model.languages.is_empty() || model.languages.iter().any(|l| !is_language_code(l)) {
        return Err(AppError::internal(format!(
            "model {} has invalid languages",
            model.id
        )));
    }
    if model.recommended_ram_gb < model.min_ram_gb
        || model.recommended_vram_gb < model.min_vram_gb
        || model.min_ram_gb < 0.0
        || model.min_vram_gb < 0.0
    {
        return Err(AppError::internal(format!(
            "model {} has inconsistent memory requirements",
            model.id
        )));
    }
    if model.supported_os.is_empty() || model.supported_arch.is_empty() {
        return Err(AppError::internal(format!(
            "model {} supports no OS/arch",
            model.id
        )));
    }
    if model.license.trim().is_empty() || model.attribution.trim().is_empty() {
        return Err(AppError::internal(format!(
            "model {} is missing license/attribution",
            model.id
        )));
    }
    Ok(())
}

pub(crate) fn is_safe_slug(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && id.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_' || b == b'-'
        })
}

fn is_semver(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 8 && p.bytes().all(|b| b.is_ascii_digit()))
}

fn validate_filename(model_id: &str, name: &str) -> AppResult<()> {
    // Bare filenames or safe relative subpaths (e.g. `tokenizer/vocab.json`).
    // Every segment must be a plain name: no traversal, no absolute paths,
    // no dotfiles, max depth 3.
    let segments: Vec<&str> = name.split('/').collect();
    let bad = name.is_empty()
        || name.len() > 255
        || segments.len() > 3
        || segments.iter().any(|s| {
            s.is_empty() || *s == "." || s.starts_with('.') || s.contains("..") || s.contains('\\')
        });
    if bad {
        return Err(AppError::internal(format!(
            "model {model_id} has an unsafe filename: {name}"
        )));
    }
    Ok(())
}

fn validate_https_url(model_id: &str, raw: &str) -> AppResult<()> {
    let parsed = reqwest::Url::parse(raw)
        .map_err(|_| AppError::internal(format!("model {model_id} has a malformed URL")))?;
    if parsed.scheme() != "https" {
        return Err(AppError::internal(format!(
            "model {model_id} URL must use HTTPS"
        )));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_language_code(code: &str) -> bool {
    let base = code.split('-').next().unwrap_or("");
    (base.len() == 2 || base.len() == 3) && base.bytes().all(|b| b.is_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_file(name: &str) -> ModelFile {
        ModelFile {
            filename: name.to_string(),
            url: "https://cdn.example.com/models/demo/encoder.onnx".to_string(),
            fallback_url: None,
            sha256: "ab".repeat(32),
            size_bytes: 1024,
        }
    }

    fn example_model() -> LocalModel {
        LocalModel {
            id: "demo-model".to_string(),
            name: "Demo Model".to_string(),
            version: "1.0.0".to_string(),
            engine: ModelEngine::SherpaOnnx,
            quantization: "int8".to_string(),
            files: vec![example_file("encoder.onnx")],
            languages: vec!["en".to_string()],
            min_ram_gb: 4.0,
            recommended_ram_gb: 8.0,
            min_vram_gb: 0.0,
            recommended_vram_gb: 0.0,
            license: "CC-BY-4.0".to_string(),
            attribution: "Example attribution".to_string(),
            supported_os: vec![ModelOs::Windows, ModelOs::Macos, ModelOs::Linux],
            supported_arch: vec![ModelArch::X64, ModelArch::Arm64],
        }
    }

    fn example_manifest() -> ModelManifest {
        ModelManifest {
            manifest_version: MANIFEST_VERSION,
            models: vec![example_model()],
        }
    }

    #[test]
    fn embedded_default_manifest_parses_and_validates_shape() {
        let manifest = default_manifest().expect("bundled manifest parses");
        assert_eq!(manifest.manifest_version, MANIFEST_VERSION);
        // Placeholders are intentional: shape-valid, but never configured
        // until converted runtime files land on the model repos.
        validate_manifest(&manifest).expect("template shape is valid");
        let ids: Vec<&str> = manifest.models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "parakeet-tdt-0.6b-v3",
                "whisper-small",
                "whisper-large-v3-turbo",
                "whisper-large-v3",
                "qwen3-asr-1.7b",
                "distil-large-v3.5",
            ]
        );
        for model in &manifest.models {
            assert!(
                !is_configured(model),
                "model {} must stay unconfigured until upload",
                model.id
            );
            assert!(model.supports_current_platform(), "{}", model.id);
            assert!(!model.files.is_empty(), "{}", model.id);
        }
        let parakeet = manifest
            .models
            .iter()
            .find(|m| m.id == "parakeet-tdt-0.6b-v3")
            .expect("parakeet entry present");
        assert_eq!(parakeet.files.len(), 4);
    }

    #[test]
    fn rejects_unsupported_manifest_version_and_empty_models() {
        let mut m = example_manifest();
        m.manifest_version = MANIFEST_VERSION + 1;
        assert!(validate_manifest(&m).is_err());
        m.manifest_version = MANIFEST_VERSION;
        m.models.clear();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_duplicate_ids_slugs_versions_and_ram() {
        let mut m = example_manifest();
        m.models.push(example_model());
        assert!(validate_manifest(&m).is_err());

        let mut m = example_manifest();
        m.models[0].id = "Bad Slug!".to_string();
        assert!(validate_manifest(&m).is_err());

        let mut m = example_manifest();
        m.models[0].version = "1.0".to_string();
        assert!(validate_manifest(&m).is_err());

        let mut m = example_manifest();
        m.models[0].recommended_ram_gb = 2.0;
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_unsafe_filenames_and_duplicates() {
        for bad in [
            "../evil.onnx",
            "C:\\evil.onnx",
            ".hidden",
            "",
            "./x.onnx",
            "a//b.onnx",
            "a/b/c/d.onnx",
            "a/./b.onnx",
        ] {
            let mut m = example_manifest();
            m.models[0].files[0].filename = bad.to_string();
            assert!(
                validate_manifest(&m).is_err(),
                "filename should be rejected: {bad}"
            );
        }
        // Safe relative subpaths (tokenizer layouts) are allowed.
        for good in ["encoder.onnx", "tokenizer/vocab.json", "a/b/c.onnx"] {
            let mut m = example_manifest();
            m.models[0].files[0].filename = good.to_string();
            assert!(
                validate_manifest(&m).is_ok(),
                "filename should be accepted: {good}"
            );
        }
        let mut m = example_manifest();
        let dup = example_file("encoder.onnx");
        m.models[0].files.push(dup);
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_non_https_urls_and_bad_checksums() {
        let mut m = example_manifest();
        m.models[0].files[0].url = "http://cdn.example.com/x".to_string();
        assert!(validate_manifest(&m).is_err());

        let mut m = example_manifest();
        m.models[0].files[0].sha256 = "not-a-hash".to_string();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_bad_languages_and_missing_license() {
        let mut m = example_manifest();
        m.models[0].languages = vec!["e".to_string()];
        assert!(validate_manifest(&m).is_err());

        let mut m = example_manifest();
        m.models[0].license = String::new();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn configured_check_detects_real_values() {
        let mut model = example_model();
        // Placeholder sha alone keeps it unconfigured.
        model.files[0].sha256 = "00".repeat(32);
        assert!(!is_configured(&model));
        model.files[0].sha256 = "ab".repeat(32);
        assert!(is_configured(&model));
    }

    #[test]
    fn known_total_bytes_sums_known_files() {
        let mut model = example_model();
        model.files.push(ModelFile {
            size_bytes: 0,
            ..example_file("other.onnx")
        });
        assert_eq!(model.known_total_bytes(), 1024);
    }

    #[test]
    fn wire_format_is_camel_case_like_shared_types() {
        // The TypeScript `localModels` schemas are the other side of this
        // contract: any rename here breaks `list_available_models` parsing.
        let manifest = default_manifest().expect("bundled manifest parses");
        let value = serde_json::to_value(&manifest).expect("serializes");
        for key in [
            "manifestVersion",
            "minRamGb",
            "recommendedRamGb",
            "minVramGb",
            "recommendedVramGb",
            "supportedOs",
            "supportedArch",
            "fallbackUrl",
            "sizeBytes",
        ] {
            assert!(
                value.to_string().contains(&format!("\"{key}\"")),
                "wire JSON must contain camelCase key {key}"
            );
        }
        for snake in [
            "manifest_version",
            "min_ram_gb",
            "supported_os",
            "size_bytes",
            "fallback_url",
        ] {
            assert!(
                !value.to_string().contains(&format!("\"{snake}\"")),
                "wire JSON must not contain snake_case key {snake}"
            );
        }
    }
}
