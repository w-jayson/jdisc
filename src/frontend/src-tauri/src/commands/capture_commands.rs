use crate::capture::audio_wasapi::start_wasapi_audio_capture;
use crate::capture::enumerate::list_all_capture_sources;
use crate::capture::video_wgc::{run_wgc_capture_loop, VideoCaptureExitReason};
use crate::media::livekit_publisher::connect_and_publish_native_stream;
use crate::state::{AppState, CaptureSource, StreamAudioMode, StreamLifecycleStatus, StreamPreset};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

pub const EVENT_STREAM_STATE_CHANGED: &str = "desktop://stream-state-changed";
pub const EVENT_AUDIO_WARNING: &str = "desktop://audio-warning";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStreamRequest {
    pub room_id: String,
    pub livekit_url: String,
    pub screenshare_token: String,
    pub source_id: String,
    pub preset: StreamPreset,
    pub audio_mode: StreamAudioMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSessionInfo {
    pub status: StreamLifecycleStatus,
    pub source_id: String,
    pub preset: StreamPreset,
    pub active_audio_mode: StreamAudioMode,
    pub audio_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStateChangedPayload {
    pub status: StreamLifecycleStatus,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioWarningPayload {
    pub code: String,
    pub message: String,
    pub active_audio_mode: StreamAudioMode,
}

#[tauri::command]
pub fn list_capture_sources() -> Result<Vec<CaptureSource>, String> {
    let result = list_all_capture_sources()?;
    let mut combined = result.windows;
    combined.extend(result.monitors);
    Ok(combined)
}

#[tauri::command]
pub async fn start_screen_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartStreamRequest,
) -> Result<StreamSessionInfo, String> {
    let sources = list_capture_sources()?;
    let matched_source = sources
        .into_iter()
        .find(|s| s.id == request.source_id)
        .ok_or_else(|| "SOURCE_NOT_FOUND".to_string())?;

    let cancel_token = CancellationToken::new();

    {
        let mut active = state
            .active_stream
            .lock()
            .map_err(|_| "ACTIVE_STREAM_LOCK_POISONED".to_string())?;
        if active.status == StreamLifecycleStatus::Streaming
            || active.status == StreamLifecycleStatus::Starting
        {
            return Err("ALREADY_STREAMING".to_string());
        }
        active.status = StreamLifecycleStatus::Starting;
        active.room_id = Some(request.room_id.clone());
        active.source_id = Some(request.source_id.clone());
        active.preset = Some(request.preset);
        active.audio_mode = Some(request.audio_mode);
        active.cancel_token = Some(cancel_token.clone());
    }

    let _ = app.emit(
        EVENT_STREAM_STATE_CHANGED,
        StreamStateChangedPayload {
            status: StreamLifecycleStatus::Starting,
            reason: None,
            message: None,
        },
    );

    let published = match connect_and_publish_native_stream(
        &request.livekit_url,
        &request.screenshare_token,
        request.preset,
        request.audio_mode,
        cancel_token.clone(),
    )
    .await
    {
        Ok(p) => p,
        Err(err) => {
            cancel_token.cancel();
            if let Ok(mut active) = state.active_stream.lock() {
                *active = Default::default();
            }
            let _ = app.emit(
                EVENT_STREAM_STATE_CHANGED,
                StreamStateChangedPayload {
                    status: StreamLifecycleStatus::Error,
                    reason: Some("livekit_connect_failed".to_string()),
                    message: Some(err.clone()),
                },
            );
            return Err(err);
        }
    };

    let mut active_audio_mode = StreamAudioMode::None;
    let mut audio_warning: Option<String> = None;

    if let Some(audio_source) = published.audio_source {
        let runtime_handle = tokio::runtime::Handle::current();
        match start_wasapi_audio_capture(
            request.audio_mode,
            matched_source.process_id,
            audio_source,
            Arc::clone(&state.audio_mix),
            cancel_token.clone(),
            runtime_handle,
        ) {
            Ok(outcome) => {
                active_audio_mode = outcome.active_mode;
                audio_warning = outcome.warning_message.clone();
                if let (Some(code), Some(msg)) = (outcome.warning_code, outcome.warning_message) {
                    let _ = app.emit(
                        EVENT_AUDIO_WARNING,
                        AudioWarningPayload {
                            code: code.to_string(),
                            message: msg,
                            active_audio_mode,
                        },
                    );
                }
            }
            Err(err) => {
                active_audio_mode = StreamAudioMode::None;
                let msg = format!(
                    "Não foi possível inicializar a captura de áudio ({err}). Prosseguindo apenas com vídeo."
                );
                audio_warning = Some(msg.clone());
                let _ = app.emit(
                    EVENT_AUDIO_WARNING,
                    AudioWarningPayload {
                        code: "PROCESS_AUDIO_FALLBACK".to_string(),
                        message: msg,
                        active_audio_mode: StreamAudioMode::None,
                    },
                );
            }
        }
    }

    let app_for_exit = app.clone();
    let cancel_for_exit = cancel_token.clone();

    if let Err(err) = run_wgc_capture_loop(
        request.source_id.clone(),
        request.preset,
        published.video_source,
        cancel_token.clone(),
        move |exit_reason| {
            cancel_for_exit.cancel();
            if let Some(app_state) = app_for_exit.try_state::<AppState>() {
                if let Ok(mut active) = app_state.active_stream.lock() {
                    *active = Default::default();
                }
            }

            let payload = match exit_reason {
                VideoCaptureExitReason::Cancelled => StreamStateChangedPayload {
                    status: StreamLifecycleStatus::Idle,
                    reason: Some("stopped_by_user".to_string()),
                    message: None,
                },
                VideoCaptureExitReason::SourceClosed => StreamStateChangedPayload {
                    status: StreamLifecycleStatus::Idle,
                    reason: Some("source_closed".to_string()),
                    message: Some(
                        "A janela ou monitor compartilhado foi fechado. Sua transmissão foi encerrada automaticamente."
                            .to_string(),
                    ),
                },
                VideoCaptureExitReason::DrmOrUnavailable => StreamStateChangedPayload {
                    status: StreamLifecycleStatus::Error,
                    reason: Some("drm_or_unavailable".to_string()),
                    message: Some(
                        "Não foi possível capturar frames de vídeo desta janela (conteúdo protegido por DRM ou superfície indisponível)."
                            .to_string(),
                    ),
                },
            };

            let _ = app_for_exit.emit(EVENT_STREAM_STATE_CHANGED, payload);
        },
    ) {
        cancel_token.cancel();
        if let Ok(mut active) = state.active_stream.lock() {
            *active = Default::default();
        }
        return Err(err);
    }

    if let Ok(mut active) = state.active_stream.lock() {
        active.status = StreamLifecycleStatus::Streaming;
        active.audio_mode = Some(active_audio_mode);
    }

    let _ = app.emit(
        EVENT_STREAM_STATE_CHANGED,
        StreamStateChangedPayload {
            status: StreamLifecycleStatus::Streaming,
            reason: None,
            message: None,
        },
    );

    Ok(StreamSessionInfo {
        status: StreamLifecycleStatus::Streaming,
        source_id: request.source_id,
        preset: request.preset,
        active_audio_mode,
        audio_warning,
    })
}

#[tauri::command]
pub async fn stop_screen_stream(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let token_opt = {
        let mut active = state
            .active_stream
            .lock()
            .map_err(|_| "ACTIVE_STREAM_LOCK_POISONED".to_string())?;
        let token = active.cancel_token.take();
        *active = Default::default();
        token
    };

    if let Some(token) = token_opt {
        token.cancel();
    }

    let _ = app.emit(
        EVENT_STREAM_STATE_CHANGED,
        StreamStateChangedPayload {
            status: StreamLifecycleStatus::Idle,
            reason: Some("stopped_by_user".to_string()),
            message: None,
        },
    );

    Ok(())
}
