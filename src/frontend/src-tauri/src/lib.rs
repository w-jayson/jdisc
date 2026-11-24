pub mod audio;
pub mod capture;
pub mod commands;
pub mod media;
pub mod shortcuts;
pub mod state;

use commands::audio_commands::set_stream_audio_mix;
use commands::capture_commands::{
    list_capture_sources, set_stream_aspect_mode, set_stream_preview_enabled, start_screen_stream,
    stop_screen_stream,
};
use commands::settings_commands::{get_app_settings, save_app_settings};
use commands::shortcut_commands::{register_global_shortcut, unregister_global_shortcut};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_app_settings,
            save_app_settings,
            list_capture_sources,
            start_screen_stream,
            stop_screen_stream,
            set_stream_preview_enabled,
            set_stream_aspect_mode,
            set_stream_audio_mix,
            register_global_shortcut,
            unregister_global_shortcut
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use tauri::Manager;
                if let Some(app_state) = window.try_state::<AppState>() {
                    if let Ok(mut active) = app_state.active_stream.lock() {
                        if let Some(token) = active.cancel_token.take() {
                            token.cancel();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running jdisc desktop application");
}
