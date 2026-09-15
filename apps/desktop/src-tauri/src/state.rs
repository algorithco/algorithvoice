use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::{Mutex, RwLock};

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
}

impl AppState {
    pub fn with_hotkey(hotkey: impl Into<String>) -> Self {
        Self {
            tray_state: Mutex::new(TrayState::Idle),
            hotkey: RwLock::new(hotkey.into()),
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

/// Matches the previous stub JSON `{ valid, next }`.
#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub valid: bool,
    pub next: &'static str,
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
