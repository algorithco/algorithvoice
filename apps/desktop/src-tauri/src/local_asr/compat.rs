//! Hardware compatibility evaluation for local models.
//!
//! Pure function of ({@link HardwareInfo}, free disk, model): no I/O, fully
//! unit-testable. Unknown GPUs are treated as CPU-only (safe direction);
//! unknown disk space skips the disk gate (writes still fail safe).

use crate::local_asr::hardware::HardwareInfo;
use crate::local_asr::manifest::LocalModel;
use crate::local_asr::models::DISK_HEADROOM_BYTES;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Compatibility {
    Unsupported,
    BarelyCompatible,
    Compatible,
    Recommended,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityReport {
    pub level: Compatibility,
    /// Human-readable, UI-safe reason lines (always at least one).
    pub reasons: Vec<String>,
}

pub struct CompatInput<'a> {
    pub hardware: &'a HardwareInfo,
    pub free_disk_bytes: Option<u64>,
    pub model: &'a LocalModel,
}

const BYTES_PER_GB: f64 = 1_000_000_000.0;

fn gb(bytes: u64) -> f64 {
    bytes as f64 / BYTES_PER_GB
}

/// Evaluate whether `model` can run on `hardware`.
///
/// Gate order is deliberate: platform, then RAM (load-bearing), then VRAM
/// (only when the model needs it), then disk (only when both known), then
/// the RAM-based tier. First failing gate wins; every report carries the
/// deciding reason plus context.
pub fn evaluate(input: &CompatInput<'_>) -> CompatibilityReport {
    let hw = input.hardware;
    let model = input.model;
    let mut reasons = Vec::new();

    if !model.supports_current_platform() {
        return CompatibilityReport {
            level: Compatibility::Unsupported,
            reasons: vec![format!(
                "{} is not built for {} {}",
                model.name, hw.os, hw.arch
            )],
        };
    }

    let total_ram = gb(hw.total_ram_bytes);
    if model.min_ram_gb > 0.0 && total_ram < model.min_ram_gb {
        return CompatibilityReport {
            level: Compatibility::Unsupported,
            reasons: vec![format!(
                "{} needs at least {:.0} GB RAM to load (this machine: {:.1} GB)",
                model.name, model.min_ram_gb, total_ram
            )],
        };
    }

    if model.min_vram_gb > 0.0 {
        let vram = hw
            .gpu
            .as_ref()
            .and_then(|g| g.total_vram_bytes)
            .map(gb)
            .unwrap_or(0.0);
        if vram < model.min_vram_gb {
            return CompatibilityReport {
                level: Compatibility::Unsupported,
                reasons: vec![format!(
                    "{} needs at least {:.0} GB VRAM (detected: {})",
                    model.name,
                    model.min_vram_gb,
                    hw.gpu
                        .as_ref()
                        .and_then(|g| g.name.clone())
                        .unwrap_or_else(|| "no discrete GPU".to_string())
                )],
            };
        }
    }

    let known_total: u64 = model.files.iter().map(|f| f.size_bytes).sum();
    if known_total > 0 {
        if let Some(free) = input.free_disk_bytes {
            let need = known_total.saturating_add(DISK_HEADROOM_BYTES);
            if free < need {
                return CompatibilityReport {
                    level: Compatibility::Unsupported,
                    reasons: vec![format!(
                        "not enough free disk space: need ~{:.1} GB, have {:.1} GB",
                        need as f64 / BYTES_PER_GB,
                        free as f64 / BYTES_PER_GB
                    )],
                };
            }
            reasons.push(format!(
                "{:.1} GB free for a ~{:.1} GB download",
                free as f64 / BYTES_PER_GB,
                known_total as f64 / BYTES_PER_GB
            ));
        }
    }

    if model.recommended_ram_gb > 0.0 && total_ram < model.recommended_ram_gb {
        reasons.push(format!(
            "{:.1} GB RAM is below the recommended {:.0} GB — expect slower transcription",
            total_ram, model.recommended_ram_gb
        ));
        return CompatibilityReport {
            level: Compatibility::BarelyCompatible,
            reasons,
        };
    }

    reasons.push(format!(
        "{:.1} GB RAM (recommended {:.0} GB), CPU inference",
        total_ram,
        model.recommended_ram_gb.max(model.min_ram_gb)
    ));
    let level = if model.recommended_ram_gb > 0.0 && total_ram >= 2.0 * model.recommended_ram_gb {
        Compatibility::Recommended
    } else {
        Compatibility::Compatible
    };
    CompatibilityReport { level, reasons }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_asr::hardware::{GpuInfo, HardwareInfo, RUNTIME_SHERPA_CPU};
    use crate::local_asr::manifest::{default_manifest, validate_manifest};

    fn hardware() -> HardwareInfo {
        HardwareInfo {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            cpu_model: Some("Test CPU".to_string()),
            cpu_cores_physical: Some(4),
            cpu_cores_logical: 8,
            total_ram_bytes: 16 * 1024 * 1024 * 1024,
            available_ram_bytes: 8 * 1024 * 1024 * 1024,
            gpu: None,
            supported_runtimes: vec![RUNTIME_SHERPA_CPU.to_string()],
        }
    }

    fn parakeet() -> LocalModel {
        let manifest = default_manifest().expect("manifest");
        validate_manifest(&manifest).expect("valid");
        manifest
            .models
            .into_iter()
            .find(|m| m.id == "parakeet-tdt-0.6b-v3")
            .expect("parakeet")
    }

    fn input<'a>(hardware: &'a HardwareInfo, model: &'a LocalModel) -> CompatInput<'a> {
        CompatInput {
            hardware,
            free_disk_bytes: Some(100 * 1024 * 1024 * 1024),
            model,
        }
    }

    #[test]
    fn capable_machine_is_compatible_or_better() {
        let hw = hardware();
        let model = parakeet();
        let report = evaluate(&input(&hw, &model));
        assert!(
            matches!(
                report.level,
                Compatibility::Compatible | Compatibility::Recommended
            ),
            "16 GB vs 8 GB recommended should pass, got {:?}",
            report.level
        );
        assert!(!report.reasons.is_empty());
    }

    #[test]
    fn low_ram_is_barely_or_unsupported() {
        let mut hw = hardware();
        hw.total_ram_bytes = 6 * 1024 * 1024 * 1024; // >= 4 min, < 8 rec
        let model = parakeet();
        let report = evaluate(&input(&hw, &model));
        assert_eq!(report.level, Compatibility::BarelyCompatible);

        hw.total_ram_bytes = 2 * 1024 * 1024 * 1024; // < 4 min
        let report = evaluate(&input(&hw, &model));
        assert_eq!(report.level, Compatibility::Unsupported);
    }

    #[test]
    fn wrong_platform_is_unsupported() {
        let hw = hardware();
        let mut model = parakeet();
        // Empty support lists match no current platform on any machine.
        model.supported_os.clear();
        model.supported_arch.clear();
        let report = evaluate(&input(&hw, &model));
        assert_eq!(report.level, Compatibility::Unsupported);
        assert!(report.reasons[0].contains("not built for"));
    }

    #[test]
    fn full_disk_is_unsupported() {
        let hw = hardware();
        let mut model = parakeet();
        // Give the model a known size so the disk gate engages.
        model.files[0].size_bytes = 10 * 1024 * 1024 * 1024;
        let input = CompatInput {
            hardware: &hw,
            free_disk_bytes: Some(1024),
            model: &model,
        };
        let report = evaluate(&input);
        assert_eq!(report.level, Compatibility::Unsupported);
        assert!(report.reasons[0].contains("disk space"));
    }

    #[test]
    fn unknown_disk_skips_the_gate() {
        let hw = hardware();
        let model = parakeet();
        let input = CompatInput {
            hardware: &hw,
            free_disk_bytes: None,
            model: &model,
        };
        let report = evaluate(&input);
        assert!(matches!(
            report.level,
            Compatibility::Compatible | Compatibility::Recommended
        ));
    }

    #[test]
    fn abundant_ram_is_recommended() {
        let mut hw = hardware();
        hw.total_ram_bytes = 64 * 1024 * 1024 * 1024;
        let model = parakeet();
        let report = evaluate(&input(&hw, &model));
        assert_eq!(report.level, Compatibility::Recommended);
    }

    #[test]
    fn gpu_requirement_without_gpu_is_unsupported() {
        let hw = hardware();
        let mut model = parakeet();
        model.min_vram_gb = 8.0;
        model.recommended_vram_gb = 12.0;
        let report = evaluate(&input(&hw, &model));
        assert_eq!(report.level, Compatibility::Unsupported);
        assert!(report.reasons[0].contains("VRAM"));

        // ...and satisfied by a large enough NVIDIA GPU.
        let mut hw_gpu = hardware();
        hw_gpu.gpu = Some(GpuInfo {
            vendor: "NVIDIA".to_string(),
            name: Some("NVIDIA Test GPU".to_string()),
            total_vram_bytes: Some(16 * 1024 * 1024 * 1024),
        });
        let report = evaluate(&input(&hw_gpu, &model));
        assert!(matches!(
            report.level,
            Compatibility::Compatible | Compatibility::Recommended
        ));
    }

    #[test]
    fn all_six_models_have_expected_ram_tiers() {
        let manifest = default_manifest().expect("manifest");
        validate_manifest(&manifest).expect("valid");
        let hw = hardware(); // 16 GB
        for model in &manifest.models {
            let report = evaluate(&input(&hw, model));
            assert!(
                matches!(
                    report.level,
                    Compatibility::Compatible
                        | Compatibility::Recommended
                        | Compatibility::BarelyCompatible
                ),
                "{} should be at least barely compatible on 16GB, got {:?}: {}",
                model.id,
                report.level,
                report.reasons.join("; ")
            );
        }
        // Qwen and whisper-large-v3 need 8 GB min; 2GB machine must reject them, but whisper-small (2GB) stays barely/compatible
        let mut low_hw = hardware();
        low_hw.total_ram_bytes = 2 * 1024 * 1024 * 1024;
        let small = manifest
            .models
            .iter()
            .find(|m| m.id == "whisper-small")
            .unwrap();
        let qwen = manifest
            .models
            .iter()
            .find(|m| m.id == "qwen3-asr-1.7b")
            .unwrap();
        let large = manifest
            .models
            .iter()
            .find(|m| m.id == "whisper-large-v3")
            .unwrap();
        assert_ne!(
            evaluate(&input(&low_hw, small)).level,
            Compatibility::Unsupported,
            "whisper-small 2GB min should not be unsupported on 2GB"
        );
        assert_eq!(
            evaluate(&input(&low_hw, qwen)).level,
            Compatibility::Unsupported,
            "qwen 8GB min must be unsupported on 2GB"
        );
        assert_eq!(
            evaluate(&input(&low_hw, large)).level,
            Compatibility::Unsupported,
            "whisper-large-v3 8GB min must be unsupported on 2GB"
        );
    }

    #[test]
    fn all_six_models_report_platform_and_files() {
        let manifest = default_manifest().expect("manifest");
        for m in &manifest.models {
            assert!(m.supports_current_platform(), "{}", m.id);
            assert!(!m.files.is_empty(), "{}", m.id);
            assert!(!m.languages.is_empty(), "{}", m.id);
        }
        // Distil is English-only, parakeet covers 25 EU langs
        let distil = manifest
            .models
            .iter()
            .find(|m| m.id == "distil-large-v3.5")
            .unwrap();
        assert_eq!(distil.languages, vec!["en"]);
        let parakeet = manifest
            .models
            .iter()
            .find(|m| m.id == "parakeet-tdt-0.6b-v3")
            .unwrap();
        assert_eq!(parakeet.languages.len(), 25);
        assert!(parakeet.files.iter().any(|f| f.filename == "tokens.txt"));
        let qwen = manifest
            .models
            .iter()
            .find(|m| m.id == "qwen3-asr-1.7b")
            .unwrap();
        assert_eq!(qwen.files.len(), 6);
        assert!(qwen
            .files
            .iter()
            .any(|f| f.filename == "tokenizer/vocab.json"));
    }
}
