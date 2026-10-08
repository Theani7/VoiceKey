use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppStatus {
    #[default]
    Idle,
    Recording,
    Processing,
    Writing,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub global_shortcut: String,
    pub push_to_talk: bool,
    pub launch_at_login: bool,
    pub show_menu_bar_icon: bool,
    pub start_on_launch: bool,
    pub auto_punctuation: bool,
    pub normalize_numbers: bool,
    pub smart_whitespace: bool,
    pub audio_device: Option<String>,
    pub save_audio: bool,
    pub save_transcripts: bool,
    pub enable_history: bool,
    pub roman_nepali: bool,
    pub active_model_id: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            global_shortcut: "Alt+Space".to_string(),
            push_to_talk: false,
            launch_at_login: false,
            show_menu_bar_icon: true,
            start_on_launch: true,
            auto_punctuation: true,
            normalize_numbers: true,
            smart_whitespace: true,
            audio_device: None,
            save_audio: false,
            save_transcripts: false,
            enable_history: false,
            roman_nepali: false,
            active_model_id: "kriti-nepali".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelStatus {
    Available,
    Downloading,
    Paused,
    Verifying,
    Installing,
    Installed,
    Active,
    UpdateAvailable,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub streaming: bool,
    pub offline: bool,
    pub punctuation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCompatibility {
    pub apple_silicon: bool,
    pub minimum_ram_gb: u32,
    pub minimum_macos: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPerformance {
    pub accuracy: u32, // 1-5 scale or percentage
    pub speed: u32,
    pub memory: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub percentage: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceModel {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub languages: Vec<String>,
    pub task: String,
    pub parameters: Option<u64>,
    pub download_size_bytes: Option<u64>,
    pub installed_size_bytes: Option<u64>,
    pub runtime: String,
    pub license: Option<String>,
    pub developer: Option<String>,
    pub source_url: Option<String>,
    pub capabilities: ModelCapabilities,
    pub compatibility: ModelCompatibility,
    pub performance: Option<ModelPerformance>,
    pub status: ModelStatus,
    pub download_progress: Option<DownloadProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemCapabilities {
    pub chip_name: String,
    pub apple_silicon: bool,
    pub total_ram_gb: u32,
    pub macos_version: String,
    pub offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub normalized_text: String,
    pub duration_seconds: f64,
}

pub fn get_default_models() -> Vec<VoiceModel> {
    vec![
        VoiceModel {
            id: "kriti-nepali".to_string(),
            name: "Kriti".to_string(),
            version: "1.0.0".to_string(),
            description: "High-accuracy native Nepali speech recognition optimized for Apple Silicon.".to_string(),
            languages: vec!["Nepali".to_string()],
            task: "Speech to Text".to_string(),
            parameters: Some(119_000_000),
            download_size_bytes: Some(480 * 1024 * 1024),
            installed_size_bytes: Some(512 * 1024 * 1024),
            runtime: "PyTorch / NeMo".to_string(),
            license: Some("Apache 2.0".to_string()),
            developer: Some("Harshil et al. / Kriti Project".to_string()),
            source_url: Some("https://huggingface.co/harrrshall/kriti".to_string()),
            capabilities: ModelCapabilities {
                streaming: true,
                offline: true,
                punctuation: true,
            },
            compatibility: ModelCompatibility {
                apple_silicon: true,
                minimum_ram_gb: 8,
                minimum_macos: "14.0".to_string(),
            },
            performance: Some(ModelPerformance {
                accuracy: 92,
                speed: 96,
                memory: 85,
            }),
            status: ModelStatus::Active,
            download_progress: None,
        },
        VoiceModel {
            id: "whisper-small-multi".to_string(),
            name: "Whisper Small".to_string(),
            version: "v3".to_string(),
            description: "OpenAI Whisper multilingual model supporting Nepali, English, Hindi, and 90+ languages.".to_string(),
            languages: vec!["Multilingual".to_string(), "Nepali".to_string(), "English".to_string(), "Hindi".to_string()],
            task: "Speech to Text".to_string(),
            parameters: Some(244_000_000),
            download_size_bytes: Some(960 * 1024 * 1024),
            installed_size_bytes: Some(1024 * 1024 * 1024),
            runtime: "Core ML".to_string(),
            license: Some("MIT".to_string()),
            developer: Some("OpenAI / Apple Core ML".to_string()),
            source_url: Some("https://huggingface.co/openai/whisper-small".to_string()),
            capabilities: ModelCapabilities {
                streaming: false,
                offline: true,
                punctuation: true,
            },
            compatibility: ModelCompatibility {
                apple_silicon: true,
                minimum_ram_gb: 8,
                minimum_macos: "14.0".to_string(),
            },
            performance: Some(ModelPerformance {
                accuracy: 94,
                speed: 84,
                memory: 78,
            }),
            status: ModelStatus::Installed,
            download_progress: None,
        },
        VoiceModel {
            id: "whisper-large-v3".to_string(),
            name: "Whisper Large v3".to_string(),
            version: "v3-turbo".to_string(),
            description: "State-of-the-art multilingual speech recognition across 100+ languages with exceptional accuracy.".to_string(),
            languages: vec!["Multilingual".to_string(), "100+ languages".to_string()],
            task: "Speech to Text".to_string(),
            parameters: Some(1_550_000_000),
            download_size_bytes: Some(3_072 * 1024 * 1024),
            installed_size_bytes: Some(3_200 * 1024 * 1024),
            runtime: "MLX (Metal)".to_string(),
            license: Some("MIT".to_string()),
            developer: Some("OpenAI / MLX Community".to_string()),
            source_url: Some("https://huggingface.co/openai/whisper-large-v3".to_string()),
            capabilities: ModelCapabilities {
                streaming: false,
                offline: true,
                punctuation: true,
            },
            compatibility: ModelCompatibility {
                apple_silicon: true,
                minimum_ram_gb: 16,
                minimum_macos: "14.2".to_string(),
            },
            performance: Some(ModelPerformance {
                accuracy: 98,
                speed: 70,
                memory: 55,
            }),
            status: ModelStatus::Available,
            download_progress: None,
        },
        VoiceModel {
            id: "indic-conformer-nepali".to_string(),
            name: "IndicConformer Regional".to_string(),
            version: "2.1.0".to_string(),
            description: "Compact regional acoustic model trained on South Asian dialects including Nepali, Maithili, and Bhojpuri.".to_string(),
            languages: vec!["Nepali".to_string(), "Maithili".to_string(), "Hindi".to_string()],
            task: "Speech to Text".to_string(),
            parameters: Some(85_000_000),
            download_size_bytes: Some(340 * 1024 * 1024),
            installed_size_bytes: Some(380 * 1024 * 1024),
            runtime: "ONNX Runtime".to_string(),
            license: Some("CC-BY-4.0".to_string()),
            developer: Some("AI4Bharat".to_string()),
            source_url: Some("https://ai4bharat.iitm.ac.in".to_string()),
            capabilities: ModelCapabilities {
                streaming: true,
                offline: true,
                punctuation: false,
            },
            compatibility: ModelCompatibility {
                apple_silicon: true,
                minimum_ram_gb: 8,
                minimum_macos: "13.0".to_string(),
            },
            performance: Some(ModelPerformance {
                accuracy: 89,
                speed: 98,
                memory: 92,
            }),
            status: ModelStatus::Available,
            download_progress: None,
        },
        VoiceModel {
            id: "fast-conformer-newari".to_string(),
            name: "NepalBhasha Conformer".to_string(),
            version: "0.9-beta".to_string(),
            description: "Experimental speech recognition model trained for Newari (Nepal Bhasha) and indigenous languages.".to_string(),
            languages: vec!["Newari".to_string()],
            task: "Speech to Text".to_string(),
            parameters: Some(64_000_000),
            download_size_bytes: Some(250 * 1024 * 1024),
            installed_size_bytes: Some(280 * 1024 * 1024),
            runtime: "Core ML".to_string(),
            license: Some("OpenRAIL".to_string()),
            developer: Some("Kriti Open Lab".to_string()),
            source_url: Some("https://github.com/kriti-asr/nepalbhasha".to_string()),
            capabilities: ModelCapabilities {
                streaming: true,
                offline: true,
                punctuation: false,
            },
            compatibility: ModelCompatibility {
                apple_silicon: true,
                minimum_ram_gb: 8,
                minimum_macos: "14.0".to_string(),
            },
            performance: Some(ModelPerformance {
                accuracy: 85,
                speed: 95,
                memory: 94,
            }),
            status: ModelStatus::Available,
            download_progress: None,
        },
    ]
}
