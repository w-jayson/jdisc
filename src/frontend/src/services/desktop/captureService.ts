import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioMixConfig,
  AudioWarningEvent,
  CaptureSource,
  StartStreamRequest,
  StreamSessionInfo,
  StreamStateChangedEvent,
} from "./types";

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  if (!isTauriEnvironment()) {
    return [];
  }
  return invoke<CaptureSource[]>("list_capture_sources");
}

export async function startScreenStream(
  request: StartStreamRequest
): Promise<StreamSessionInfo> {
  return invoke<StreamSessionInfo>("start_screen_stream", { request });
}

export async function stopScreenStream(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  await invoke<void>("stop_screen_stream");
}

export async function setStreamAudioMix(config: AudioMixConfig): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  await invoke<void>("set_stream_audio_mix", { config });
}

export async function onStreamStateChanged(
  handler: (payload: StreamStateChangedEvent) => void
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }
  return listen<StreamStateChangedEvent>(
    "desktop://stream-state-changed",
    (event) => {
      handler(event.payload);
    }
  );
}

export async function onAudioWarning(
  handler: (payload: AudioWarningEvent) => void
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }
  return listen<AudioWarningEvent>("desktop://audio-warning", (event) => {
    handler(event.payload);
  });
}
