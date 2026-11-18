use crate::state::{GlobalShortcutConfig, ShortcutMode};
use serde::Serialize;
use std::str::FromStr;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const EVENT_GLOBAL_SHORTCUT_TRIGGERED: &str = "desktop://global-shortcut-triggered";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutTriggeredPayload {
    pub mode: ShortcutMode,
    pub action: &'static str,
}

pub fn apply_global_shortcut(
    app: &AppHandle,
    config: &GlobalShortcutConfig,
) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if !config.enabled {
        return Ok(());
    }

    let raw_accel = match config.accelerator.as_deref() {
        Some(a) if !a.trim().is_empty() => a.trim(),
        _ => return Ok(()),
    };

    let shortcut = Shortcut::from_str(raw_accel)
        .map_err(|e| format!("SHORTCUT_CONFLICT: Acelerador inválido '{raw_accel}' ({e})"))?;

    let mode = config.mode;
    gs.on_shortcut(shortcut, move |app_handle, _scut, event| {
        match (mode, event.state) {
            (ShortcutMode::Toggle, ShortcutState::Pressed) => {
                let _ = app_handle.emit(
                    EVENT_GLOBAL_SHORTCUT_TRIGGERED,
                    GlobalShortcutTriggeredPayload {
                        mode: ShortcutMode::Toggle,
                        action: "pressed",
                    },
                );
            }
            (ShortcutMode::PushToTalk, ShortcutState::Pressed) => {
                let _ = app_handle.emit(
                    EVENT_GLOBAL_SHORTCUT_TRIGGERED,
                    GlobalShortcutTriggeredPayload {
                        mode: ShortcutMode::PushToTalk,
                        action: "pressed",
                    },
                );
            }
            (ShortcutMode::PushToTalk, ShortcutState::Released) => {
                let _ = app_handle.emit(
                    EVENT_GLOBAL_SHORTCUT_TRIGGERED,
                    GlobalShortcutTriggeredPayload {
                        mode: ShortcutMode::PushToTalk,
                        action: "released",
                    },
                );
            }
            _ => {}
        }
    })
    .map_err(|e| {
        format!(
            "SHORTCUT_CONFLICT: Não foi possível registrar o atalho '{raw_accel}' no Windows ({e})"
        )
    })?;

    Ok(())
}

pub fn clear_global_shortcuts(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("SHORTCUT_UNREGISTER_FAILED: {e}"))
}
