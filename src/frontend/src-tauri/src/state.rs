use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub access_token: String,
    pub expires_at: String,
    pub user_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixConfig {
    pub volume: u8,
    pub muted: bool,
}

impl Default for AudioMixConfig {
    fn default() -> Self {
        Self {
            volume: 100,
            muted: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutMode {
    Toggle,
    PushToTalk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutConfig {
    pub enabled: bool,
    pub mode: ShortcutMode,
    pub accelerator: Option<String>,
}

impl Default for GlobalShortcutConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: ShortcutMode::Toggle,
            accelerator: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NoiseReductionPreset {
    Light,
    Moderate,
    Aggressive,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoiseReductionConfig {
    pub enabled: bool,
    pub preset: NoiseReductionPreset,
    pub threshold_db: i16,
    pub high_pass_hz: u16,
    pub webrtc_noise_suppression: bool,
}

impl Default for NoiseReductionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            preset: NoiseReductionPreset::Moderate,
            threshold_db: -45,
            high_pass_hz: 95,
            webrtc_noise_suppression: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceConfig {
    #[serde(default)]
    pub input_device_id: Option<String>,
    #[serde(default)]
    pub output_device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub server_url: String,
    pub auth_session: Option<AuthSession>,
    pub participant_volumes: HashMap<String, u16>,
    pub stream_audio_mix: AudioMixConfig,
    pub global_shortcut: GlobalShortcutConfig,
    #[serde(default)]
    pub noise_reduction: NoiseReductionConfig,
    #[serde(default)]
    pub audio_devices: AudioDeviceConfig,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            server_url: "http://localhost:5000".to_string(),
            auth_session: None,
            participant_volumes: HashMap::new(),
            stream_audio_mix: AudioMixConfig::default(),
            global_shortcut: GlobalShortcutConfig::default(),
            noise_reduction: NoiseReductionConfig::default(),
            audio_devices: AudioDeviceConfig::default(),
        }
    }
}

fn normalize_device_id(id: Option<String>) -> Option<String> {
    id.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("default") {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

impl AppSettings {
    pub fn normalized(mut self) -> Self {
        let trimmed = self.server_url.trim().trim_end_matches('/').to_string();
        self.server_url = if trimmed.is_empty() {
            "http://localhost:5000".to_string()
        } else {
            trimmed
        };

        for vol in self.participant_volumes.values_mut() {
            if *vol > 200 {
                *vol = 200;
            }
        }

        if self.stream_audio_mix.volume > 100 {
            self.stream_audio_mix.volume = 100;
        }

        self.noise_reduction.threshold_db = self.noise_reduction.threshold_db.clamp(-70, -15);
        self.noise_reduction.high_pass_hz = self.noise_reduction.high_pass_hz.clamp(0, 300);
        self.audio_devices.input_device_id =
            normalize_device_id(self.audio_devices.input_device_id);
        self.audio_devices.output_device_id =
            normalize_device_id(self.audio_devices.output_device_id);

        self
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureSourceKind {
    Window,
    Monitor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: String,
    pub kind: CaptureSourceKind,
    pub title: String,
    pub process_id: Option<u32>,
    pub process_name: Option<String>,
    pub icon_base64: Option<String>,
    pub width: u32,
    pub height: u32,
    pub supports_process_audio_isolation: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StreamPreset {
    #[serde(rename = "720p30")]
    P720Fps30,
    #[serde(rename = "1080p60")]
    P1080Fps60,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StreamAudioMode {
    ProcessTree,
    SystemGlobal,
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StreamLifecycleStatus {
    Idle,
    Starting,
    Streaming,
    Stopping,
    Error,
}

pub struct AudioMixState {
    volume_bits: AtomicU32,
    muted: AtomicBool,
}

impl Default for AudioMixState {
    fn default() -> Self {
        Self::new(100, false)
    }
}

impl AudioMixState {
    pub fn new(volume_percent: u8, muted: bool) -> Self {
        let clamped = volume_percent.min(100) as f32 / 100.0;
        Self {
            volume_bits: AtomicU32::new(clamped.to_bits()),
            muted: AtomicBool::new(muted),
        }
    }

    pub fn update(&self, volume_percent: u8, muted: bool) {
        let clamped = volume_percent.min(100) as f32 / 100.0;
        self.volume_bits.store(clamped.to_bits(), Ordering::Relaxed);
        self.muted.store(muted, Ordering::Relaxed);
    }

    pub fn gain(&self) -> f32 {
        f32::from_bits(self.volume_bits.load(Ordering::Relaxed))
    }

    pub fn is_muted(&self) -> bool {
        self.muted.load(Ordering::Relaxed)
    }
}

pub struct ActiveStreamState {
    pub room_id: Option<String>,
    pub source_id: Option<String>,
    pub source_title: Option<String>,
    pub preset: Option<StreamPreset>,
    pub audio_mode: Option<StreamAudioMode>,
    pub status: StreamLifecycleStatus,
    pub cancel_token: Option<CancellationToken>,
}

impl Default for ActiveStreamState {
    fn default() -> Self {
        Self {
            room_id: None,
            source_id: None,
            source_title: None,
            preset: None,
            audio_mode: None,
            status: StreamLifecycleStatus::Idle,
            cancel_token: None,
        }
    }
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub active_stream: Mutex<ActiveStreamState>,
    pub audio_mix: Arc<AudioMixState>,
    pub preview_enabled: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AppSettings::default()),
            active_stream: Mutex::new(ActiveStreamState::default()),
            audio_mix: Arc::new(AudioMixState::default()),
            preview_enabled: Arc::new(AtomicBool::new(true)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_url_and_clamps_volumes() {
        let mut volumes = HashMap::new();
        volumes.insert("u1".to_string(), 250);
        volumes.insert("u2".to_string(), 145);

        let raw = AppSettings {
            server_url: "  https://jdisc.example.com/  ".to_string(),
            auth_session: None,
            participant_volumes: volumes,
            stream_audio_mix: AudioMixConfig {
                volume: 180,
                muted: false,
            },
            global_shortcut: GlobalShortcutConfig::default(),
            noise_reduction: NoiseReductionConfig {
                enabled: true,
                preset: NoiseReductionPreset::Custom,
                threshold_db: -120,
                high_pass_hz: 900,
                webrtc_noise_suppression: false,
            },
            audio_devices: AudioDeviceConfig {
                input_device_id: Some("  mic-1  ".to_string()),
                output_device_id: Some("default".to_string()),
            },
        };

        let normalized = raw.normalized();
        assert_eq!(normalized.server_url, "https://jdisc.example.com");
        assert_eq!(normalized.participant_volumes.get("u1"), Some(&200));
        assert_eq!(normalized.participant_volumes.get("u2"), Some(&145));
        assert_eq!(normalized.stream_audio_mix.volume, 100);
        assert_eq!(normalized.noise_reduction.threshold_db, -70);
        assert_eq!(normalized.noise_reduction.high_pass_hz, 300);
        assert_eq!(
            normalized.audio_devices.input_device_id.as_deref(),
            Some("mic-1")
        );
        assert_eq!(normalized.audio_devices.output_device_id, None);
    }

    #[test]
    fn deserializes_legacy_settings_without_noise_reduction() {
        let legacy_json = r#"{
            "serverUrl": "https://jdisc.example.com",
            "authSession": null,
            "participantVolumes": {},
            "streamAudioMix": { "volume": 100, "muted": false },
            "globalShortcut": { "enabled": false, "mode": "toggle", "accelerator": null }
        }"#;

        let parsed: AppSettings = serde_json::from_str(legacy_json).expect("legacy JSON should parse");
        assert_eq!(parsed.noise_reduction, NoiseReductionConfig::default());
        assert_eq!(parsed.audio_devices, AudioDeviceConfig::default());
    }
}
