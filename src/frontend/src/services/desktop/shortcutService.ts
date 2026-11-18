import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  GlobalShortcutConfig,
  GlobalShortcutTriggeredEvent,
} from "./types";

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function registerGlobalShortcut(
  config: GlobalShortcutConfig
): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  await invoke<void>("register_global_shortcut", { config });
}

export async function unregisterGlobalShortcut(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  await invoke<void>("unregister_global_shortcut");
}

export async function onGlobalShortcutTriggered(
  handler: (payload: GlobalShortcutTriggeredEvent) => void
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }
  return listen<GlobalShortcutTriggeredEvent>(
    "desktop://global-shortcut-triggered",
    (event) => {
      handler(event.payload);
    }
  );
}
