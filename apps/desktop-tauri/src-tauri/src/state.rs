use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::{atomic::AtomicBool, Mutex, RwLock};
use std::time::Instant;

/// Tray icon state. Deserializes from the same lowercase strings the
/// frontend already sends (`"idle" | "recording" | "processing"`), so
/// `invoke("set_tray_state", { state })` keeps working unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayState {
    #[default]
    Idle,
    Recording,
    Processing,
}

impl TrayState {
    pub fn icon_bytes(self) -> &'static [u8] {
        match self {
            Self::Recording => include_bytes!("../icons/tray-recording.png"),
            Self::Processing => include_bytes!("../icons/tray-processing.png"),
            Self::Idle => include_bytes!("../icons/tray-idle.png"),
        }
    }

    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Recording => "Algorith Voice — recording",
            Self::Processing => "Algorith Voice — processing",
            Self::Idle => "Algorith Voice",
        }
    }
}

impl FromStr for TrayState {
    type Err = String;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "idle" => Ok(Self::Idle),
            "recording" => Ok(Self::Recording),
            "processing" => Ok(Self::Processing),
            other => Err(format!("unknown tray state: {other}")),
        }
    }
}

impl std::fmt::Display for TrayState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            Self::Idle => "idle",
            Self::Recording => "recording",
            Self::Processing => "processing",
        };
        write!(f, "{label}")
    }
}

/// In-memory app state shared across commands.
///
/// One small struct per concern (Tauri best practice: the *type* is the
/// registry key). `Mutex` for write-heavy tray flag, `RwLock` for
/// read-heavy hotkey string.
#[derive(Debug, Default)]
pub struct AppState {
    pub tray_state: Mutex<TrayState>,
    pub hotkey: RwLock<String>,
    /// Set when the tray `Quit` item is used. While set, window-close
    /// requests are allowed through so the runtime can exit fully instead
    /// of hiding windows back into the tray.
    pub exiting: AtomicBool,
    /// Last server-verified subscription. Starts invalid and is refreshed by
    /// `license_status`; native transcription also refreshes it when stale.
    pub entitlement: Mutex<EntitlementCache>,
    /// Serializes access-token refresh across main/settings/pill webviews.
    pub entitlement_refresh: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn with_hotkey(hotkey: impl Into<String>) -> Self {
        Self {
            tray_state: Mutex::new(TrayState::Idle),
            hotkey: RwLock::new(hotkey.into()),
            exiting: AtomicBool::new(false),
            entitlement: Mutex::new(EntitlementCache::default()),
            entitlement_refresh: tokio::sync::Mutex::new(()),
        }
    }
}

/// Local SQLite handle. Initialized once in `setup()` from the platform
/// `app_data_dir`, shared via `.manage()`. Phase 3 history lands here;
/// commands added later read/write through this lock with prepared
/// statements (no string-interpolated SQL).
#[allow(dead_code)]
pub struct Db(pub Mutex<rusqlite::Connection>);

/// Matches the frontend `SessionInfo` shape exactly:
/// `{ loggedIn: boolean, email?: string | null }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

impl SessionStatus {
    pub fn logged_out() -> Self {
        Self {
            logged_in: false,
            email: None,
        }
    }

    pub fn logged_in(email: impl Into<String>) -> Self {
        let email = email.into();
        Self {
            logged_in: true,
            email: if email.is_empty() { None } else { Some(email) },
        }
    }
}

#[derive(Debug, Clone)]
pub struct EntitlementCache {
    pub status: LicenseStatus,
    pub checked_at: Option<Instant>,
    pub api_base: String,
}

impl Default for EntitlementCache {
    fn default() -> Self {
        Self {
            status: LicenseStatus::unverified(),
            checked_at: None,
            api_base: String::new(),
        }
    }
}

/// Server-verified desktop entitlement shown by the renderer and enforced by
/// native commands. Unknown/network failure is always invalid (fail closed).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub valid: bool,
    pub status: String,
    pub plan_tier: String,
    pub current_period_end: Option<String>,
    pub reason: Option<String>,
}

impl LicenseStatus {
    pub fn unverified() -> Self {
        Self {
            valid: false,
            status: "unverified".to_string(),
            plan_tier: "free".to_string(),
            current_period_end: None,
            reason: Some("Subscription has not been verified".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_state_round_trips_frontend_strings() {
        assert_eq!("idle".parse::<TrayState>().unwrap(), TrayState::Idle);
        assert_eq!(
            "recording".parse::<TrayState>().unwrap(),
            TrayState::Recording
        );
        let json = serde_json::to_value(SessionStatus::logged_in("a@b.c")).unwrap();
        assert_eq!(json.get("loggedIn").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(json.get("email").and_then(|v| v.as_str()), Some("a@b.c"));
    }
}
