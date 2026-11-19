use crate::state::{AppSettings, AppState};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "app_settings";

#[tauri::command]
pub fn get_app_settings(app: AppHandle, state: State<'_, AppState>) -> Result<AppSettings, String> {
    if let Ok(store) = app.store(STORE_FILE) {
        if let Some(val) = store.get(SETTINGS_KEY) {
            if let Ok(parsed) = serde_json::from_value::<AppSettings>(val) {
                let normalized = parsed.normalized();
                if let Ok(mut guard) = state.settings.lock() {
                    *guard = normalized.clone();
                }
                state.audio_mix.update(
                    normalized.stream_audio_mix.volume,
                    normalized.stream_audio_mix.muted,
                );
                return Ok(normalized);
            }
        }
    }

    let guard = state
        .settings
        .lock()
        .map_err(|_| "STATE_LOCK_FAILED".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let normalized = settings.normalized();

    {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "STATE_LOCK_FAILED".to_string())?;
        *guard = normalized.clone();
    }

    state.audio_mix.update(
        normalized.stream_audio_mix.volume,
        normalized.stream_audio_mix.muted,
    );

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let serialized = serde_json::to_value(&normalized).map_err(|e| e.to_string())?;
    store.set(SETTINGS_KEY, serialized);
    store.save().map_err(|e| e.to_string())?;

    Ok(normalized)
}
