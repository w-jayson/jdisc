import { useCallback, useEffect, useState } from "react";
import { issueRoomScreenshareToken } from "../services/api/roomsApi";
import {
  onAudioWarning,
  onStreamStateChanged,
  setStreamAudioMix as invokeSetStreamAudioMix,
  startScreenStream,
  stopScreenStream,
} from "../services/desktop/captureService";
import type {
  AudioMixConfig,
  StreamAudioMode,
  StreamPreset,
} from "../services/desktop/types";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";
import { useRoomStore } from "../stores/roomStore";

export function useDesktopStreaming() {
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const localStreamStatus = useRoomStore((s) => s.localStreamStatus);
  const localStreamPreset = useRoomStore((s) => s.localStreamPreset);
  const localStreamAudioMode = useRoomStore((s) => s.localStreamAudioMode);
  const localStreamWarning = useRoomStore((s) => s.localStreamWarning);
  const setLocalStreamState = useRoomStore((s) => s.setLocalStreamState);

  const streamAudioMix = useDesktopSettingsStore(
    (s) => s.settings.streamAudioMix
  );
  const setStreamAudioMixStore = useDesktopSettingsStore(
    (s) => s.setStreamAudioMix
  );

  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenWarn: (() => void) | undefined;

    void onStreamStateChanged((payload) => {
      setLocalStreamState({
        status: payload.status,
        warning: payload.message ?? undefined,
      });
      if (payload.status === "error" && payload.message) {
        setStreamError(payload.message);
      }
    }).then((fn) => {
      unlistenState = fn;
    });

    void onAudioWarning((payload) => {
      setLocalStreamState({
        audioMode: payload.activeAudioMode,
        warning: payload.message,
      });
    }).then((fn) => {
      unlistenWarn = fn;
    });

    return () => {
      unlistenState?.();
      unlistenWarn?.();
    };
  }, [setLocalStreamState]);

  const startStream = useCallback(
    async (
      sourceId: string,
      preset: StreamPreset,
      audioMode: StreamAudioMode
    ) => {
      if (!activeRoomId) {
        setStreamError("Conecte-se a uma sala de voz antes de compartilhar a tela.");
        return false;
      }

      setStreamError(null);
      setLocalStreamState({ status: "starting", preset, audioMode, warning: null });

      try {
        const tokenResp = await issueRoomScreenshareToken(
          activeRoomId,
          preset,
          audioMode
        );

        const sessionInfo = await startScreenStream({
          roomId: activeRoomId,
          livekitUrl: tokenResp.livekitUrl,
          screenshareToken: tokenResp.token,
          sourceId,
          preset,
          audioMode,
        });

        setLocalStreamState({
          status: sessionInfo.status,
          preset: sessionInfo.preset,
          audioMode: sessionInfo.activeAudioMode,
          warning: sessionInfo.audioWarning,
        });

        return true;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "string"
            ? err
            : "Falha ao iniciar captura nativa de tela.";
        setStreamError(msg);
        setLocalStreamState({ status: "idle" });
        return false;
      }
    },
    [activeRoomId, setLocalStreamState]
  );

  const stopStream = useCallback(async () => {
    setStreamError(null);
    await stopScreenStream();
    setLocalStreamState({ status: "idle", warning: null });
  }, [setLocalStreamState]);

  const updateStreamAudioMix = useCallback(
    async (nextMix: AudioMixConfig) => {
      setStreamAudioMixStore(nextMix);
      await invokeSetStreamAudioMix(nextMix);
    },
    [setStreamAudioMixStore]
  );

  return {
    localStreamStatus,
    localStreamPreset,
    localStreamAudioMode,
    localStreamWarning,
    streamAudioMix,
    streamError,
    clearStreamError: () => setStreamError(null),
    startStream,
    stopStream,
    updateStreamAudioMix,
  };
}
