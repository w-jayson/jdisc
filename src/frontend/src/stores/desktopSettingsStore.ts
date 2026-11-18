import { create } from "zustand";
import type {
  AppSettings,
  AudioMixConfig,
  AuthSession,
  GlobalShortcutConfig,
} from "../services/desktop/types";

const DEFAULT_SERVER_URL =
  import.meta.env.VITE_DEFAULT_SERVER_URL || "http://localhost:5000";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  serverUrl: DEFAULT_SERVER_URL.replace(/\/+$/, ""),
  authSession: null,
  participantVolumes: {},
  streamAudioMix: { volume: 100, muted: false },
  globalShortcut: { enabled: false, mode: "toggle", accelerator: null },
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
}

export const useDesktopSettingsStore = create<DesktopSettingsState>((set) => ({
  settings: DEFAULT_APP_SETTINGS,
  hydrated: false,
  setSettings: (settings) =>
    set({
      settings: {
        ...settings,
        serverUrl: settings.serverUrl.trim().replace(/\/+$/, "") || DEFAULT_SERVER_URL,
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
}));
