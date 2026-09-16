//! Hardware detection: CPU, memory, OS/arch, best-effort discrete GPU.
//!
//! CPU/RAM/disk come from `sysinfo`. Dedicated GPUs are probed by
//! dynamically loading NVML (`libloading`): machines without NVIDIA
//! hardware or drivers behave identically minus the GPU fields — there is
//! deliberately no link-time dependency, so startup can never fail for
//! want of a driver DLL. Non-NVIDIA GPUs are reported as unknown; the
//! compatibility evaluator treats unknown GPUs as CPU-only (safe side).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// GPU vendor as detected, e.g. `"NVIDIA"`.
    pub vendor: String,
    /// Marketing name, e.g. `"NVIDIA GeForce RTX 4070"`, when readable.
    pub name: Option<String>,
    /// Total VRAM in bytes, when readable.
    pub total_vram_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    /// `std::env::consts::OS`: `"windows"`, `"macos"`, `"linux"`, ...
    pub os: String,
    /// `std::env::consts::ARCH`: `"x86_64"`, `"aarch64"`, ...
    pub arch: String,
    /// CPU marketing string, e.g. `"Intel(R) Core(TM) i7-12700K"`.
    pub cpu_model: Option<String>,
    /// Physical cores, when the OS exposes a count.
    pub cpu_cores_physical: Option<usize>,
    /// Logical cores (always present; falls back to 1, never 0).
    pub cpu_cores_logical: usize,
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    /// `None` means no detectable discrete GPU — not an error.
    pub gpu: Option<GpuInfo>,
    /// Inference runtimes this build can actually drive. The linked sherpa
    /// static libraries are CPU-only, so this is `["sherpa-onnx-cpu"]` until
    /// a CUDA-enabled provider ships (Phase 5+).
    pub supported_runtimes: Vec<String>,
}

pub const RUNTIME_SHERPA_CPU: &str = "sherpa-onnx-cpu";

/// Snapshot local hardware. Infallible by construction: every probe has an
/// unknown-shaped fallback, so detection itself can never break startup.
pub fn detect() -> HardwareInfo {
    let mut system = sysinfo::System::new_all();
    system.refresh_memory();
    system.refresh_cpu_all();

    let cpu_model = system
        .cpus()
        .iter()
        .map(|cpu| cpu.brand().trim())
        .find(|brand| !brand.is_empty())
        .map(str::to_owned);
    let cpu_cores_logical = system.cpus().len().max(1);

    HardwareInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_model,
        cpu_cores_physical: sysinfo::System::physical_core_count(),
        cpu_cores_logical,
        total_ram_bytes: system.total_memory(),
        available_ram_bytes: system.available_memory(),
        gpu: detect_nvidia_gpu(),
        supported_runtimes: vec![RUNTIME_SHERPA_CPU.to_string()],
    }
}

/// Probe NVIDIA GPUs through a runtime-loaded NVML. Returns `None` when the
/// library, any symbol, or any call is unavailable — callers treat that as
/// "no discrete GPU", never as failure.
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn detect_nvidia_gpu() -> Option<GpuInfo> {
    #[cfg(target_os = "windows")]
    const CANDIDATES: &[&str] = &["nvml.dll"];
    #[cfg(target_os = "linux")]
    const CANDIDATES: &[&str] = &["libnvidia-ml.so.1", "libnvidia-ml.so"];

    // NVML C ABI, stable for over a decade. Signatures mirror nvml.h:
    // nvmlReturn_t f(void/args...), NVML_SUCCESS == 0.
    type Status = i32;
    const SUCCESS: Status = 0;

    // SAFETY: all calls go through verified function pointers with exact
    // C signatures; string buffers are pre-zeroed and clamped below.
    unsafe {
        let mut loaded = None;
        for name in CANDIDATES {
            if let Ok(lib) = libloading::Library::new(name) {
                loaded = Some(lib);
                break;
            }
        }
        let lib = loaded?;

        // init (v2 preferred, v1 fallback — both have shipped for years).
        let mut inited = false;
        for symbol in [b"nvmlInit_v2\0".as_slice(), b"nvmlInit\0".as_slice()] {
            if let Ok(f) = lib.get::<unsafe extern "C" fn() -> Status>(symbol) {
                if f() == SUCCESS {
                    inited = true;
                    break;
                }
            }
        }
        if !inited {
            return None;
        }
        // From here on, shut NVML back down on every exit path.
        let result = detect_nvidia_gpu_inner(&lib);
        if let Ok(f) = lib.get::<unsafe extern "C" fn() -> Status>(b"nvmlShutdown\0") {
            let _ = f();
        }
        result
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
unsafe fn detect_nvidia_gpu_inner(lib: &libloading::Library) -> Option<GpuInfo> {
    type Status = i32;
    type Device = *mut std::os::raw::c_void;
    const SUCCESS: Status = 0;

    unsafe {
        let mut count_fn = None;
        for symbol in [
            b"nvmlDeviceGetCount_v2\0".as_slice(),
            b"nvmlDeviceGetCount\0".as_slice(),
        ] {
            if let Ok(f) = lib.get::<unsafe extern "C" fn(*mut u32) -> Status>(symbol) {
                count_fn = Some(f);
                break;
            }
        }
        let count_fn = count_fn?;
        let mut count: u32 = 0;
        if count_fn(&mut count) != SUCCESS || count == 0 {
            return None;
        }
        let mut handle_fn = None;
        for symbol in [
            b"nvmlDeviceGetHandleByIndex_v2\0".as_slice(),
            b"nvmlDeviceGetHandleByIndex\0".as_slice(),
        ] {
            if let Ok(f) = lib.get::<unsafe extern "C" fn(u32, *mut Device) -> Status>(symbol) {
                handle_fn = Some(f);
                break;
            }
        }
        let handle_fn = handle_fn?;
        let mut device: Device = std::ptr::null_mut();
        if handle_fn(0, &mut device) != SUCCESS || device.is_null() {
            return None;
        }
        let name = lib
            .get::<unsafe extern "C" fn(Device, *mut i8, u32) -> Status>(b"nvmlDeviceGetName\0")
            .ok()
            .and_then(|f| {
                let mut buf = [0i8; 96];
                if f(device, buf.as_mut_ptr(), buf.len() as u32) != SUCCESS {
                    return None;
                }
                // Clamp the last byte: guarantees NUL termination for
                // from_ptr even against a misbehaving driver.
                buf[buf.len() - 1] = 0;
                let name: String = std::ffi::CStr::from_ptr(buf.as_ptr())
                    .to_string_lossy()
                    .into_owned();
                (!name.trim().is_empty()).then_some(name)
            });
        // nvmlMemory_t { unsigned long long total, free, used }.
        #[repr(C)]
        struct Memory {
            total: u64,
            free: u64,
            used: u64,
        }
        let total_vram_bytes = lib
            .get::<unsafe extern "C" fn(Device, *mut Memory) -> Status>(
                b"nvmlDeviceGetMemoryInfo\0",
            )
            .ok()
            .and_then(|f| {
                let mut mem = Memory {
                    total: 0,
                    free: 0,
                    used: 0,
                };
                (f(device, &mut mem) == SUCCESS && mem.total > 0).then_some(mem.total)
            });
        Some(GpuInfo {
            vendor: "NVIDIA".to_string(),
            name,
            total_vram_bytes,
        })
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn detect_nvidia_gpu() -> Option<GpuInfo> {
    // No NVIDIA driver model on other OSes (Apple Silicon is unified
    // memory; CPU inference is the supported path there).
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_sane_basics_on_any_machine() {
        let hw = detect();
        assert!(!hw.os.is_empty());
        assert!(!hw.arch.is_empty());
        assert!(hw.cpu_cores_logical >= 1);
        assert!(hw.total_ram_bytes > 0);
        assert_eq!(hw.supported_runtimes, vec![RUNTIME_SHERPA_CPU]);
        // Physical cores may be unknown on some platforms; when present it
        // cannot exceed logical (SMT never reports fewer logical CPUs).
        if let Some(physical) = hw.cpu_cores_physical {
            assert!(physical >= 1);
            assert!(physical <= hw.cpu_cores_logical);
        }
        // GPU probe must never panic and must stay consistent: a reported
        // GPU always names NVIDIA as its vendor.
        if let Some(gpu) = &hw.gpu {
            assert_eq!(gpu.vendor, "NVIDIA");
        }
    }

    #[test]
    fn gpu_info_shape_is_stable() {
        let gpu = GpuInfo {
            vendor: "NVIDIA".to_string(),
            name: Some("NVIDIA GeForce RTX 4070".to_string()),
            total_vram_bytes: Some(12_884_901_888),
        };
        let value = serde_json::to_value(&gpu).expect("serializes");
        assert_eq!(value.get("vendor").and_then(|v| v.as_str()), Some("NVIDIA"));
        assert_eq!(
            value.get("totalVramBytes").and_then(|v| v.as_u64()),
            Some(12_884_901_888)
        );
    }
}
