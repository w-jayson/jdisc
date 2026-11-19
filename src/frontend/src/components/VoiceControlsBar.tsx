import React from "react";
import type {
  NoiseReductionConfig,
  StreamLifecycleStatus,
} from "../services/desktop/types";
import { NOISE_REDUCTION_PRESETS } from "../services/realtime/noiseReductionProcessor";

interface VoiceControlsBarProps {
  activeRoomName: string | null;
  callConnectionState:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting";
  isMicMuted: boolean;
  isDeafened: boolean;
  noiseReduction: NoiseReductionConfig;
  localStreamStatus: StreamLifecycleStatus;
  onToggleMicMute: () => void;
  onToggleDeafen: () => void;
  onToggleNoiseReduction: () => void;
  onOpenAudioSettings: () => void;
  onOpenScreenSharePicker: () => void;
  onStopScreenShare: () => void;
  onLeaveRoom: () => void;
}

export const VoiceControlsBar: React.FC<VoiceControlsBarProps> = ({
  activeRoomName,
  callConnectionState,
  isMicMuted,
  isDeafened,
  noiseReduction,
  localStreamStatus,
  onToggleMicMute,
  onToggleDeafen,
  onToggleNoiseReduction,
  onOpenAudioSettings,
  onOpenScreenSharePicker,
  onStopScreenShare,
  onLeaveRoom,
}) => {
  if (callConnectionState === "disconnected") {
    return null;
  }

  const isStreaming =
    localStreamStatus === "streaming" || localStreamStatus === "starting";
  const noisePresetLabel =
    noiseReduction.preset === "custom"
      ? `${noiseReduction.thresholdDb} dB`
      : NOISE_REDUCTION_PRESETS[noiseReduction.preset].label;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "10px",
        padding: "10px 16px",
        background: "#1e1f22",
        borderTop: "1px solid #2b2d31",
        flexShrink: 0,
      }}
    >
      <div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#23a55a" }}>
          {callConnectionState === "connected"
            ? "Voz Conectada"
            : callConnectionState === "reconnecting"
            ? "Reconectando Voz..."
            : "Conectando..."}
        </div>
        <div style={{ fontSize: "12px", color: "#b5bac1" }}>
          Sala: {activeRoomName ?? "—"}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <button
          type="button"
          onClick={onToggleMicMute}
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            border: "none",
            background: isMicMuted ? "#da373c" : "#383a40",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isMicMuted ? "🔇 Desmutar Mic" : "🎙️ Mutar Mic"}
        </button>

        <button
          type="button"
          onClick={onToggleDeafen}
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            border: "none",
            background: isDeafened ? "#da373c" : "#383a40",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isDeafened ? "🎧🚫 Desensurdecer" : "🎧 Ensurdecer"}
        </button>

        <button
          type="button"
          onClick={onToggleNoiseReduction}
          title={
            noiseReduction.enabled
              ? `Redutor de ruído ativo (${noisePresetLabel}). Clique para desativar.`
              : "Redutor de ruído desativado. Clique para ativar."
          }
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: noiseReduction.enabled
              ? "1px solid #23a55a"
              : "1px solid #3f4147",
            background: noiseReduction.enabled
              ? "rgba(35, 165, 90, 0.2)"
              : "#383a40",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {noiseReduction.enabled
            ? `✨ Ruído: ON (${noisePresetLabel})`
            : "✨ Ruído: OFF"}
        </button>

        <button
          type="button"
          onClick={onOpenAudioSettings}
          title="Configurar Redutor de Ruído e Limiar do Microfone"
          style={{
            padding: "8px 10px",
            borderRadius: "6px",
            border: "none",
            background: "#383a40",
            color: "#dbdee1",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ⚙️ Áudio
        </button>

        {!isStreaming ? (
          <button
            type="button"
            onClick={onOpenScreenSharePicker}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: "#5865f2",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🖥️ Compartilhar Tela / Jogo
          </button>
        ) : (
          <button
            type="button"
            onClick={onStopScreenShare}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: "#da373c",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ⏹️ Parar Transmissão
          </button>
        )}

        <button
          type="button"
          onClick={onLeaveRoom}
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            border: "1px solid #da373c",
            background: "transparent",
            color: "#f23f43",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Desconectar
        </button>
      </div>
    </div>
  );
};
