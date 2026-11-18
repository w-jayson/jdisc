export type CaptureSourceKind = "window" | "monitor";
export type StreamPreset = "720p30" | "1080p60";
export type StreamAudioMode = "process_tree" | "system_global" | "none";
export type ShortcutMode = "toggle" | "push_to_talk";
export type StreamLifecycleStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "stopping"
  | "error";

export interface AuthSession {
  accessToken: string;
  expiresAt: string;
  userId: string;
  displayName: string;
}

export interface AudioMixConfig {
  volume: number;
  muted: boolean;
}

export interface GlobalShortcutConfig {
  enabled: boolean;
  mode: ShortcutMode;
  accelerator: string | null;
}

export interface AppSettings {
  serverUrl: string;
  authSession: AuthSession | null;
  participantVolumes: Record<string, number>;
  streamAudioMix: AudioMixConfig;
  globalShortcut: GlobalShortcutConfig;
}

export interface CaptureSource {
  id: string;
  kind: CaptureSourceKind;
  title: string;
  processId: number | null;
  processName: string | null;
  iconBase64: string | null;
  width: number;
  height: number;
  supportsProcessAudioIsolation: boolean;
}

export interface StartStreamRequest {
  roomId: string;
  livekitUrl: string;
  screenshareToken: string;
  sourceId: string;
  preset: StreamPreset;
  audioMode: StreamAudioMode;
}

export interface StreamSessionInfo {
  status: StreamLifecycleStatus;
  sourceId: string;
  preset: StreamPreset;
  activeAudioMode: StreamAudioMode;
  audioWarning: string | null;
}

export interface StreamStateChangedEvent {
  status: StreamLifecycleStatus;
  reason?: string | null;
  message?: string | null;
}

export interface GlobalShortcutTriggeredEvent {
  mode: ShortcutMode;
  action: "pressed" | "released";
}

export interface AudioWarningEvent {
  code: string;
  message: string;
  activeAudioMode: StreamAudioMode;
}
