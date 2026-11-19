import { useCallback, useState } from "react";
import { ApiError } from "../services/api/httpClient";
import { issueRoomVoiceToken } from "../services/api/roomsApi";
import { saveAppSettings } from "../services/desktop/settingsService";
import type { NoiseReductionConfig } from "../services/desktop/types";
import { livekitService } from "../services/realtime/livekitService";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";
import { useRoomStore } from "../stores/roomStore";

export function useVoiceCall() {
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const activeRoomName = useRoomStore((s) => s.activeRoomName);
  const callConnectionState = useRoomStore((s) => s.callConnectionState);
  const isMicMuted = useRoomStore((s) => s.isMicMuted);
  const isDeafened = useRoomStore((s) => s.isDeafened);
  const noiseReduction = useDesktopSettingsStore(
    (s) => s.settings.noiseReduction
  );
  const [joinError, setJoinError] = useState<string | null>(null);

  const joinRoom = useCallback(async (roomId: string) => {
    setJoinError(null);
    try {
      const tokenDto = await issueRoomVoiceToken(roomId);
      const matchedRoom = useRoomStore
        .getState()
        .rooms.find((r) => r.id === roomId);
      await livekitService.connectToVoiceRoom(
        roomId,
        matchedRoom?.name ?? tokenDto.roomId,
        tokenDto.livekitUrl,
        tokenDto.token
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setJoinError(
          err.message || "Sala cheia — máximo 10 participantes"
        );
      } else {
        setJoinError(
          err instanceof Error
            ? err.message
            : "Não foi possível conectar à sala de voz."
        );
      }
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    setJoinError(null);
    await livekitService.disconnectFromVoiceRoom();
  }, []);

  const toggleMicMute = useCallback(async () => {
    await livekitService.toggleMicMute();
  }, []);

  const toggleDeafen = useCallback(async () => {
    await livekitService.toggleDeafen();
  }, []);

  const updateParticipantVolume = useCallback(
    async (userId: string, volumePercent: number) => {
      livekitService.setParticipantVolume(userId, volumePercent);
      const updated = useDesktopSettingsStore.getState().settings;
      await saveAppSettings(updated);
    },
    []
  );

  const toggleNoiseReduction = useCallback(async () => {
    await livekitService.toggleNoiseReduction();
  }, []);

  const updateNoiseReduction = useCallback(
    async (config: NoiseReductionConfig, persist = true) => {
      await livekitService.updateNoiseReduction(config, persist);
    },
    []
  );

  return {
    activeRoomId,
    activeRoomName,
    callConnectionState,
    isMicMuted,
    isDeafened,
    noiseReduction,
    joinError,
    clearJoinError: () => setJoinError(null),
    joinRoom,
    leaveRoom,
    toggleMicMute,
    toggleDeafen,
    toggleNoiseReduction,
    updateNoiseReduction,
    updateParticipantVolume,
  };
}
