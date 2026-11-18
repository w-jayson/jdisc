import { useEffect } from "react";
import {
  onGlobalShortcutTriggered,
  registerGlobalShortcut,
} from "../services/desktop/shortcutService";
import { livekitService } from "../services/realtime/livekitService";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";
import { useRoomStore } from "../stores/roomStore";

export function useGlobalShortcutSync() {
  const hydrated = useDesktopSettingsStore((s) => s.hydrated);
  const globalShortcut = useDesktopSettingsStore(
    (s) => s.settings.globalShortcut
  );

  useEffect(() => {
    if (!hydrated) return;
    if (globalShortcut.enabled && globalShortcut.accelerator) {
      void registerGlobalShortcut(globalShortcut).catch(() => {
        // Ignore startup conflict; user can rebind in settings modal
      });
    }
  }, [hydrated, globalShortcut]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void onGlobalShortcutTriggered((payload) => {
      const { activeRoomId } = useRoomStore.getState();
      if (!activeRoomId) {
        return;
      }

      if (payload.mode === "toggle" && payload.action === "pressed") {
        void livekitService.toggleMicMute();
      } else if (payload.mode === "push_to_talk") {
        if (payload.action === "pressed") {
          void livekitService.setMicMuted(false);
        } else if (payload.action === "released") {
          void livekitService.setMicMuted(true);
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
