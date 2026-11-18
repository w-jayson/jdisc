use crate::commands::settings_commands::save_app_settings;
use crate::shortcuts::global_shortcut::{apply_global_shortcut, clear_global_shortcuts};
use crate::state::{AppState, GlobalShortcutConfig};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn register_global_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    config: GlobalShortcutConfig,
) -> Result<(), String> {
    apply_global_shortcut(&app, &config)?;

    let updated_settings = {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "SETTINGS_LOCK_POISONED".to_string())?;
        guard.global_shortcut = config;
        guard.clone()
    };

    let _ = save_app_settings(app, state, updated_settings)?;
    Ok(())
}

#[tauri::command]
pub fn unregister_global_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    clear_global_shortcuts(&app)?;

    let updated_settings = {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "SETTINGS_LOCK_POISONED".to_string())?;
        guard.global_shortcut.enabled = false;
        guard.clone()
    };

    let _ = save_app_settings(app, state, updated_settings)?;
    Ok(())
}
