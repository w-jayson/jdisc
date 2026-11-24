import React from "react";
import type {
  AudioMixConfig,
  StreamAspectMode,
  StreamAudioMode,
  StreamLifecycleStatus,
  StreamPreset,
} from "../services/desktop/types";

interface StreamAudioMixerControlProps {
  status: StreamLifecycleStatus;
  preset: StreamPreset;
  audioMode: StreamAudioMode;
  aspectMode: StreamAspectMode;
  audioMix: AudioMixConfig;
  warning: string | null;
  onUpdateMix: (next: AudioMixConfig) => void;
  onUpdateAspectMode: (next: StreamAspectMode) => void;
}

export const StreamAudioMixerControl: React.FC<
  StreamAudioMixerControlProps
> = ({
  status,
  preset,
  audioMode,
  aspectMode,
  audioMix,
  warning,
  onUpdateMix,
  onUpdateAspectMode,
}) => {
  if (status !== "streaming" && status !== "starting") {
    return null;
  }

  return (
    <div
      style={{
        padding: "10px 18px",
        background: "#232428",
        borderTop: "1px solid #2b2d31",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              background: "#da373c",
              color: "#ffffff",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            TRANSMITINDO ({preset})
          </span>
          <span style={{ fontSize: "12px", color: "#b5bac1" }}>
            Áudio da Transmissão:{" "}
            {audioMode === "process_tree"
              ? "Isolado por Processo (WASAPI)"
              : audioMode === "system_global"
              ? "Global do Sistema"
              : "Desativado"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#dbdee1",
            }}
          >
            Proporção:
            <select
              value={aspectMode}
              onChange={(e) =>
                onUpdateAspectMode(e.target.value as StreamAspectMode)
              }
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                background: "#383a40",
                color: "#ffffff",
                border: "1px solid #4e5058",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              <option value="original">Original</option>
              <option value="stretch_16_9">Esticar 16:9</option>
              <option value="crop_4_3_stretch_16_9">Recortar 4:3 → 16:9</option>
            </select>
          </label>

          {audioMode !== "none" && (
            <>
              <button
                type="button"
                onClick={() =>
                  onUpdateMix({
                    ...audioMix,
                    muted: !audioMix.muted,
                  })
                }
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  border: "none",
                  background: audioMix.muted ? "#da373c" : "#383a40",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {audioMix.muted
                  ? "🔇 Áudio do Jogo Mutado"
                  : "🔊 Mutar Áudio do Jogo"}
              </button>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "#dbdee1",
                }}
              >
                Volume do Jogo ({audioMix.volume}%):
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={audioMix.volume}
                  onChange={(e) =>
                    onUpdateMix({
                      ...audioMix,
                      volume: Number(e.target.value),
                    })
                  }
                  style={{ cursor: "pointer" }}
                />
              </label>
            </>
          )}
        </div>
      </div>

      {warning && (
        <div
          style={{
            fontSize: "12px",
            color: "#f0b232",
            background: "rgba(240, 178, 50, 0.12)",
            padding: "6px 10px",
            borderRadius: "4px",
          }}
        >
          ⚠️ {warning}
        </div>
      )}
    </div>
  );
};
