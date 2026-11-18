import React, { useEffect, useState } from "react";
import { listCaptureSources } from "../services/desktop/captureService";
import type {
  CaptureSource,
  StreamAudioMode,
  StreamPreset,
} from "../services/desktop/types";

interface ScreenSharePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartStream: (
    sourceId: string,
    preset: StreamPreset,
    audioMode: StreamAudioMode
  ) => Promise<boolean>;
}

export const ScreenSharePickerModal: React.FC<ScreenSharePickerModalProps> = ({
  isOpen,
  onClose,
  onStartStream,
}) => {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedTab, setSelectedTab] = useState<"window" | "monitor">(
    "window"
  );
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [preset, setPreset] = useState<StreamPreset>("1080p60");
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    void listCaptureSources()
      .then((items) => {
        setSources(items);
        const firstWindow = items.find((i) => i.kind === "window");
        const firstMonitor = items.find((i) => i.kind === "monitor");
        if (firstWindow) {
          setSelectedTab("window");
          setSelectedSourceId(firstWindow.id);
        } else if (firstMonitor) {
          setSelectedTab("monitor");
          setSelectedSourceId(firstMonitor.id);
        }
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const filteredSources = sources.filter((s) => s.kind === selectedTab);
  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  const effectiveAudioMode: StreamAudioMode = !includeAudio
    ? "none"
    : selectedSource?.kind === "window" &&
      selectedSource.supportsProcessAudioIsolation
    ? "process_tree"
    : "system_global";

  const handleConfirm = async () => {
    if (!selectedSourceId) return;
    setSubmitting(true);
    try {
      const ok = await onStartStream(
        selectedSourceId,
        preset,
        effectiveAudioMode
      );
      if (ok) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "680px",
          background: "#2b2d31",
          borderRadius: "10px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          maxHeight: "88vh",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", color: "#f2f3f5" }}>
            Compartilhar Tela ou Jogo (Windows Graphics Capture)
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#b5bac1",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => {
              setSelectedTab("window");
              const first = sources.find((s) => s.kind === "window");
              if (first) setSelectedSourceId(first.id);
            }}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: selectedTab === "window" ? "#5865f2" : "#1e1f22",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Janelas / Jogos (Áudio Isolado por Processo)
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedTab("monitor");
              const first = sources.find((s) => s.kind === "monitor");
              if (first) setSelectedSourceId(first.id);
            }}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: selectedTab === "monitor" ? "#5865f2" : "#1e1f22",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Telas Inteiras / Monitores
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "10px",
            minHeight: "200px",
            padding: "4px",
          }}
        >
          {loading ? (
            <div style={{ color: "#b5bac1", fontSize: "13px" }}>
              Enumerando janelas e monitores via Win32...
            </div>
          ) : filteredSources.length === 0 ? (
            <div style={{ color: "#b5bac1", fontSize: "13px" }}>
              Nenhuma fonte encontrada nesta categoria.
            </div>
          ) : (
            filteredSources.map((src) => {
              const isSelected = src.id === selectedSourceId;
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => setSelectedSourceId(src.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px",
                    borderRadius: "8px",
                    border: isSelected
                      ? "2px solid #5865f2"
                      : "1px solid #1e1f22",
                    background: isSelected ? "#35373c" : "#1e1f22",
                    color: "#f2f3f5",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {src.iconBase64 ? (
                    <img
                      src={src.iconBase64}
                      alt=""
                      style={{ width: "28px", height: "28px", flexShrink: 0 }}
                    />
                  ) : (
                    <span style={{ fontSize: "22px" }}>
                      {src.kind === "window" ? "🪟" : "🖥️"}
                    </span>
                  )}
                  <div style={{ overflow: "hidden" }}>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {src.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "#949ba4" }}>
                      {src.processName
                        ? `${src.processName} (PID ${src.processId})`
                        : `${src.width}×${src.height}`}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "16px",
            alignItems: "center",
            padding: "12px",
            background: "#1e1f22",
            borderRadius: "8px",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "#f2f3f5",
            }}
          >
            Qualidade:
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as StreamPreset)}
              style={{
                padding: "6px 10px",
                borderRadius: "4px",
                background: "#2b2d31",
                color: "#f2f3f5",
                border: "1px solid #3f4147",
              }}
            >
              <option value="720p30">720p @ 30 FPS (Fluido / Econômico)</option>
              <option value="1080p60">1080p @ 60 FPS (Alta Definição)</option>
            </select>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "#f2f3f5",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(e) => setIncludeAudio(e.target.checked)}
            />
            Compartilhar áudio{" "}
            {selectedSource?.kind === "window"
              ? "(Isolado por árvore de processos WASAPI)"
              : "(Loopback global do sistema)"}
          </label>
        </div>

        {includeAudio && effectiveAudioMode === "system_global" && (
          <div
            role="status"
            style={{
              padding: "10px 12px",
              borderRadius: "6px",
              background: "rgba(240, 178, 50, 0.15)",
              border: "1px solid #f0b232",
              color: "#f0b232",
              fontSize: "12px",
            }}
          >
            ⚠️ Aviso de Eco: Ao compartilhar um monitor inteiro com áudio global,
            as vozes da sala também poderão ser capturadas. Para evitar eco,
            prefira compartilhar a janela específica do jogo/aplicativo.
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: "#4e5058",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selectedSourceId || submitting}
            onClick={() => void handleConfirm()}
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              border: "none",
              background: "#23a55a",
              color: "#ffffff",
              fontWeight: 700,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Iniciando..." : "Transmitir Ao Vivo"}
          </button>
        </div>
      </div>
    </div>
  );
};
