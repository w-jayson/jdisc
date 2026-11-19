import { create } from "zustand";
import type {
  AppSettings,
  AudioDeviceConfig,
  AudioMixConfig,
  AuthSession,
  GlobalShortcutConfig,
  NoiseReductionConfig,
} from "../services/desktop/types";
import {
  DEFAULT_NOISE_REDUCTION_CONFIG,
  normalizeNoiseReductionConfig,
} from "../services/realtime/noiseReductionProcessor";

const DEFAULT_SERVER_URL =
  import.meta.env.VITE_DEFAULT_SERVER_URL || "http://localhost:5000";

export const DEFAULT_AUDIO_DEVICE_CONFIG: AudioDeviceConfig = {
  inputDeviceId: null,
  outputDeviceId: null,
};

function normalizeDeviceId(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return null;
  }
  return trimmed;
}

export function normalizeAudioDeviceConfig(
  input?: Partial<AudioDeviceConfig> | null
): AudioDeviceConfig {
  return {
    inputDeviceId: normalizeDeviceId(input?.inputDeviceId),
    outputDeviceId: normalizeDeviceId(input?.outputDeviceId),
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  serverUrl: DEFAULT_SERVER_URL.replace(/\/+$/, ""),
  authSession: null,
  participantVolumes: {},
  streamAudioMix: { volume: 100, muted: false },
  globalShortcut: { enabled: false, mode: "toggle", accelerator: null },
  noiseReduction: DEFAULT_NOISE_REDUCTION_CONFIG,
  audioDevices: DEFAULT_AUDIO_DEVICE_CONFIG,
};

interface DesktopSettingsState {
  settings: AppSettings;
  hydrated: boolean;
  setSettings: (settings: AppSettings) => void;
  setServerUrl: (serverUrl: string) => void;
  setAuthSession: (session: AuthSession | null) => void;
  setParticipantVolume: (userId: string, volume: number) => void;
  setStreamAudioMix: (mix: AudioMixConfig) => void;
  setGlobalShortcut: (shortcut: GlobalShortcutConfig) => void;
  setNoiseReduction: (noiseReduction: NoiseReductionConfig) => void;
  setAudioDevices: (audioDevices: AudioDeviceConfig) => void;
}

export const useDesktopSettingsStore = create<DesktopSettingsState>((set) => ({
  settings: DEFAULT_APP_SETTINGS,
  hydrated: false,
  setSettings: (settings) =>
    set({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        ...settings,
        serverUrl: settings.serverUrl.trim().replace(/\/+$/, "") || DEFAULT_SERVER_URL,
        noiseReduction: normalizeNoiseReductionConfig(settings.noiseReduction),
        audioDevices: normalizeAudioDeviceConfig(settings.audioDevices),
      },
      hydrated: true,
    }),
  setServerUrl: (serverUrl) =>
    set((state) => ({
      settings: {
        ...state.settings,
        serverUrl: serverUrl.trim().replace(/\/+$/, "") || DEFAULT_SERVER_URL,
      },
    })),
  setAuthSession: (authSession) =>
    set((state) => ({
      settings: { ...state.settings, authSession },
    })),
  setParticipantVolume: (userId, volume) =>
    set((state) => ({
      settings: {
        ...state.settings,
        participantVolumes: {
          ...state.settings.participantVolumes,
          [userId]: Math.max(0, Math.min(200, Math.round(volume))),
        },
      },
    })),
  setStreamAudioMix: (streamAudioMix) =>
    set((state) => ({
      settings: {
        ...state.settings,
        streamAudioMix: {
          volume: Math.max(0, Math.min(100, Math.round(streamAudioMix.volume))),
          muted: streamAudioMix.muted,
        },
      },
    })),
  setGlobalShortcut: (globalShortcut) =>
    set((state) => ({
      settings: { ...state.settings, globalShortcut },
    })),
  setNoiseReduction: (noiseReduction) =>
    set((state) => ({
      settings: {
        ...state.settings,
        noiseReduction: normalizeNoiseReductionConfig(noiseReduction),
      },
    })),
  setAudioDevices: (audioDevices) =>
    set((state) => ({
      settings: {
        ...state.settings,
        audioDevices: normalizeAudioDeviceConfig(audioDevices),
      },
    })),
}));
