import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_APP_SETTINGS } from "../../stores/desktopSettingsStore";
import type { AppSettings } from "./types";

const LOCAL_STORAGE_FALLBACK_KEY = "jdisc_desktop_settings_v1";

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function getAppSettings(): Promise<AppSettings> {
  if (isTauriEnvironment()) {
    return invoke<AppSettings>("get_app_settings");
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        ...DEFAULT_APP_SETTINGS,
        ...parsed,
        noiseReduction: {
          ...DEFAULT_APP_SETTINGS.noiseReduction,
          ...(parsed.noiseReduction ?? {}),
        },
        audioDevices: {
          ...DEFAULT_APP_SETTINGS.audioDevices,
          ...(parsed.audioDevices ?? {}),
        },
      };
    }
  } catch {
    // Ignore fallback storage errors
  }

  return DEFAULT_APP_SETTINGS;
}

export async function saveAppSettings(
  settings: AppSettings
): Promise<AppSettings> {
  if (isTauriEnvironment()) {
    return invoke<AppSettings>("save_app_settings", { settings });
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(settings));
  } catch {
    // Ignore fallback storage errors
  }

  return settings;
}
