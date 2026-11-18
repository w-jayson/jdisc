import { create } from "zustand";
import { saveAppSettings } from "../services/desktop/settingsService";
import type { AuthSession } from "../services/desktop/types";
import { useDesktopSettingsStore } from "./desktopSettingsStore";

interface AuthState {
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  setSession: async (session) => {
    set({ session });
    const desktopStore = useDesktopSettingsStore.getState();
    desktopStore.setAuthSession(session);
    const updated = useDesktopSettingsStore.getState().settings;
    await saveAppSettings(updated);
  },
  logout: async () => {
    set({ session: null });
    const desktopStore = useDesktopSettingsStore.getState();
    desktopStore.setAuthSession(null);
    const updated = useDesktopSettingsStore.getState().settings;
    await saveAppSettings(updated);
  },
}));
