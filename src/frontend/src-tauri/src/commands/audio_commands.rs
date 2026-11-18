use crate::commands::settings_commands::save_app_settings;
use crate::state::{AppState, AudioMixConfig};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn set_stream_audio_mix(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AudioMixConfig,
) -> Result<(), String> {
    let clamped_vol = config.volume.min(100);
    state.audio_mix.update(clamped_vol, config.muted);

    let updated_settings = {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "SETTINGS_LOCK_POISONED".to_string())?;
        guard.stream_audio_mix = AudioMixConfig {
            volume: clamped_vol,
            muted: config.muted,
        };
        guard.clone()
    };

    let _ = save_app_settings(app, state, updated_settings)?;
    Ok(())
}
