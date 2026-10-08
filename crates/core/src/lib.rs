use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppStatus {
    #[default]
    Idle,
    Recording,
    Processing,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub global_shortcut: String,
    pub push_to_talk: bool,
    pub launch_at_login: bool,
    pub auto_punctuation: bool,
    pub audio_device: Option<String>,
    pub save_audio: bool,
    pub roman_nepali: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            global_shortcut: "Alt+Space".to_string(),
            push_to_talk: false,
            launch_at_login: false,
            auto_punctuation: true,
            audio_device: None,
            save_audio: false,
            roman_nepali: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub normalized_text: String,
    pub duration_seconds: f64,
}
