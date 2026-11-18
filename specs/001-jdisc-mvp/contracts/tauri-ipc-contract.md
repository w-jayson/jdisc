# Contrato IPC Tauri (Commands & Events): React ↔ Rust

**Feature**: `001-jdisc-mvp` | **Date**: 2026-11-13

## 1. Tauri Commands (`invoke` — encapsulados em `src/frontend/src/services/desktop/`)

1. **`get_app_settings()` / `save_app_settings(settings: AppSettings)`**: Lê e persiste `settings.json` via `tauri-plugin-store`.
2. **`list_capture_sources()`**: Retorna `{ windows: CaptureSource[], monitors: CaptureSource[], processAudioSupported: boolean }`.
3. **`start_screen_stream({ roomId, livekitUrl, screenshareToken, sourceId, preset, audioMode })`**: Inicia captura WGC + WASAPI (`process_tree` / `system_global` / `none`) e publica diretamente via `livekit` Rust SDK (`{userId}:screenshare`). Retorna `{ activeAudioMode, warning }`.
4. **`stop_screen_stream()`**: Para WGC/WASAPI e desconecta o publisher Rust sem afetar a chamada de voz no WebView2.
5. **`set_stream_audio_mix({ volume, muted })`**: Atualiza `AtomicU32` (0..100%) e `AtomicBool` no pipeline PCM em tempo real.
6. **`register_global_shortcut({ accelerator, mode })` / `unregister_global_shortcut()`**: Registra/remove atalho global (`toggle` ou `push_to_talk`) via `tauri-plugin-global-shortcut`, retornando `"SHORTCUT_CONFLICT"` em caso de conflito.

## 2. Tauri Events (`listen`)

- **`desktop://stream-state-changed`**: `{ status: "starting" | "streaming" | "stopped" | "error", reason?: "source_closed" | "drm_protected" | "window_minimized" | "error", message?: string }`
- **`desktop://global-shortcut-triggered`**: `{ mode: "toggle" | "push_to_talk", state: "pressed" | "released" }`
- **`desktop://audio-warning`**: `{ code: "PROCESS_AUDIO_FALLBACK" | "SYSTEM_AUDIO_ECHO_RISK", message: string }`
