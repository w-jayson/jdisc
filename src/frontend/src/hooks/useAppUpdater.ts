import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type AppUpdaterStatus =
  | "idle"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface AppUpdaterState {
  status: AppUpdaterStatus;
  availableVersion: string | null;
  currentVersion: string | null;
  progressPercent: number | null;
  error: string | null;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export function useAppUpdater(): AppUpdaterState {
  const updateRef = useRef<Update | null>(null);
  const [status, setStatus] = useState<AppUpdaterStatus>("idle");
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriEnvironment()) {
      return;
    }

    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        const update = await check({ timeout: 10_000 });
        if (cancelled) {
          if (update) {
            await update.close().catch(() => {});
          }
          return;
        }

        if (update) {
          updateRef.current = update;
          setAvailableVersion(update.version);
          setCurrentVersion(update.currentVersion);
          setStatus("available");
        }
      } catch {
        // Ignore silent update check failures (offline, no release published yet, etc.)
      }
    };

    void checkForUpdate();

    return () => {
      cancelled = true;
      if (updateRef.current) {
        void updateRef.current.close().catch(() => {});
        updateRef.current = null;
      }
    };
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) {
      return;
    }

    setError(null);
    setStatus("downloading");
    setProgressPercent(0);

    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setProgressPercent(0);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            setProgressPercent(pct);
          }
        } else if (event.event === "Finished") {
          setProgressPercent(100);
          setStatus("installing");
        }
      });

      await relaunch();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha ao baixar ou instalar a atualização.";
      setError(message);
      setStatus("error");
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    if (updateRef.current) {
      void updateRef.current.close().catch(() => {});
      updateRef.current = null;
    }
    setStatus("idle");
    setError(null);
    setProgressPercent(null);
  }, []);

  return {
    status,
    availableVersion,
    currentVersion,
    progressPercent,
    error,
    installUpdate,
    dismissUpdate,
  };
}
