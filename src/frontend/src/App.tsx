import React, { useEffect, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { GlobalShortcutSettings } from "./components/GlobalShortcutSettings";
import { RoomSidebar } from "./components/RoomSidebar";
import { ScreenSharePickerModal } from "./components/ScreenSharePickerModal";
import { StreamAudioMixerControl } from "./components/StreamAudioMixerControl";
import { StreamStageViewer } from "./components/StreamStageViewer";
import { VoiceControlsBar } from "./components/VoiceControlsBar";
import { useDesktopStreaming } from "./hooks/useDesktopStreaming";
import { useGlobalShortcutSync } from "./hooks/useGlobalShortcutSync";
import { usePresenceHub } from "./hooks/usePresenceHub";
import { useVoiceCall } from "./hooks/useVoiceCall";
import { getAppSettings } from "./services/desktop/settingsService";
import { useAuthStore } from "./stores/authStore";
import { useDesktopSettingsStore } from "./stores/desktopSettingsStore";

export const App: React.FC = () => {
  const hydrated = useDesktopSettingsStore((s) => s.hydrated);
  const setSettings = useDesktopSettingsStore((s) => s.setSettings);
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const [isScreenPickerOpen, setIsScreenPickerOpen] = useState(false);
  const [isShortcutSettingsOpen, setIsShortcutSettingsOpen] = useState(false);

  useEffect(() => {
    void getAppSettings().then(async (loaded) => {
      setSettings(loaded);
      if (loaded.authSession) {
        await setSession(loaded.authSession);
      }
    });
  }, [setSettings, setSession]);

  usePresenceHub();
  useGlobalShortcutSync();

  const {
    activeRoomName,
    callConnectionState,
    isMicMuted,
    isDeafened,
    joinError,
    clearJoinError,
    joinRoom,
    leaveRoom,
    toggleMicMute,
    toggleDeafen,
    updateParticipantVolume,
  } = useVoiceCall();

  const {
    localStreamStatus,
    localStreamPreset,
    localStreamAudioMode,
    localStreamWarning,
    streamAudioMix,
    streamError,
    clearStreamError,
    startStream,
    stopStream,
    updateStreamAudioMix,
  } = useDesktopStreaming();

  if (!hydrated) {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111214",
          color: "#b5bac1",
        }}
      >
        Carregando configurações locais do jdisc...
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      <RoomSidebar
        onJoinRoom={(roomId) => void joinRoom(roomId)}
        onUpdateParticipantVolume={(userId, vol) =>
          void updateParticipantVolume(userId, vol)
        }
        onOpenShortcutSettings={() => setIsShortcutSettingsOpen(true)}
      />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "#313338",
          overflow: "hidden",
        }}
      >
        {(joinError || streamError) && (
          <div
            role="alert"
            style={{
              padding: "10px 16px",
              background: "#da373c",
              color: "#ffffff",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{joinError || streamError}</span>
            <button
              type="button"
              onClick={() => {
                clearJoinError();
                clearStreamError();
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        )}

        <StreamStageViewer />

        <StreamAudioMixerControl
          status={localStreamStatus}
          preset={localStreamPreset}
          audioMode={localStreamAudioMode}
          audioMix={streamAudioMix}
          warning={localStreamWarning}
          onUpdateMix={(next) => void updateStreamAudioMix(next)}
        />

        <VoiceControlsBar
          activeRoomName={activeRoomName}
          callConnectionState={callConnectionState}
          isMicMuted={isMicMuted}
          isDeafened={isDeafened}
          localStreamStatus={localStreamStatus}
          onToggleMicMute={() => void toggleMicMute()}
          onToggleDeafen={() => void toggleDeafen()}
          onOpenScreenSharePicker={() => setIsScreenPickerOpen(true)}
          onStopScreenShare={() => void stopStream()}
          onLeaveRoom={() => void leaveRoom()}
        />
      </main>

      <ScreenSharePickerModal
        isOpen={isScreenPickerOpen}
        onClose={() => setIsScreenPickerOpen(false)}
        onStartStream={startStream}
      />

      <GlobalShortcutSettings
        isOpen={isShortcutSettingsOpen}
        onClose={() => setIsShortcutSettingsOpen(false)}
      />
    </div>
  );
};
