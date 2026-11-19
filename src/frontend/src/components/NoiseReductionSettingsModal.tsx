import React, { useEffect, useRef, useState } from "react";
import type {
  NoiseReductionConfig,
  NoiseReductionPreset,
} from "../services/desktop/types";
import { livekitService } from "../services/realtime/livekitService";
import {
  applyNoiseReductionPreset,
  calculateRmsDb,
  DEFAULT_NOISE_REDUCTION_CONFIG,
  MIN_DB_FLOOR,
  NOISE_HIGHPASS_MAX_HZ,
  NOISE_HIGHPASS_MIN_HZ,
  NOISE_REDUCTION_PRESETS,
  NOISE_THRESHOLD_MAX_DB,
  NOISE_THRESHOLD_MIN_DB,
} from "../services/realtime/noiseReductionProcessor";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";
import { useRoomStore } from "../stores/roomStore";

interface NoiseReductionSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateNoiseReduction: (
    config: NoiseReductionConfig,
    persist?: boolean
  ) => Promise<void>;
}

const METER_MIN_DB = -75;
const METER_MAX_DB = 0;

function dbToPercent(db: number): number {
  const clamped = Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, db));
  return ((clamped - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
}

export const NoiseReductionSettingsModal: React.FC<
  NoiseReductionSettingsModalProps
> = ({ isOpen, onClose, onUpdateNoiseReduction }) => {
  const config = useDesktopSettingsStore((s) => s.settings.noiseReduction);
  const callConnectionState = useRoomStore((s) => s.callConnectionState);
  const isInCall = callConnectionState !== "disconnected";

  const [inputDb, setInputDb] = useState<number>(MIN_DB_FLOOR);
  const [gateOpen, setGateOpen] = useState<boolean>(false);
  const [micPreviewError, setMicPreviewError] = useState<string | null>(null);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestConfigRef = useRef(config);
  latestConfigRef.current = config;

  const schedulePersist = (nextConfig: NoiseReductionConfig) => {
    void onUpdateNoiseReduction(nextConfig, false);
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void onUpdateNoiseReduction(latestConfigRef.current, true);
    }, 250);
  };

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        void onUpdateNoiseReduction(latestConfigRef.current, true);
      }
    };
  }, [onUpdateNoiseReduction]);

  useEffect(() => {
    if (!isOpen) {
      setInputDb(MIN_DB_FLOOR);
      setGateOpen(false);
      setMicPreviewError(null);
      return;
    }

    if (isInCall && config.enabled && livekitService.isNoiseProcessorActive()) {
      setMicPreviewError(null);
      return livekitService.subscribeLocalMicLevel((sample) => {
        setInputDb(sample.inputDb);
        setGateOpen(sample.gateOpen);
      });
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setInterval> | null = null;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    const startPreviewMeter = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression:
              config.enabled && config.webrtcNoiseSuppression,
            echoCancellation: true,
            autoGainControl: true,
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        audioCtx = new window.AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const highPass = audioCtx.createBiquadFilter();
        highPass.type = "highpass";
        highPass.frequency.value =
          config.enabled && config.highPassHz > 0 ? config.highPassHz : 10;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;

        source.connect(highPass);
        highPass.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);
        setMicPreviewError(null);

        timerId = setInterval(() => {
          analyser.getFloatTimeDomainData(buffer);
          const db = calculateRmsDb(buffer);
          setInputDb(db);
          setGateOpen(db >= latestConfigRef.current.thresholdDb);
        }, 30);
      } catch {
        if (!cancelled) {
          setMicPreviewError(
            "Não foi possível acessar o microfone para exibir o medidor."
          );
        }
      }
    };

    void startPreviewMeter();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearInterval(timerId);
      }
      stream?.getTracks().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== "closed") {
        void audioCtx.close().catch(() => {});
      }
    };
  }, [
    isOpen,
    isInCall,
    config.enabled,
    config.webrtcNoiseSuppression,
    config.highPassHz,
  ]);

  if (!isOpen) {
    return null;
  }

  const handleToggleEnabled = (enabled: boolean) => {
    void onUpdateNoiseReduction({ ...config, enabled }, true);
  };

  const handleSelectPreset = (
    preset: Exclude<NoiseReductionPreset, "custom">
  ) => {
    const next = applyNoiseReductionPreset({ ...config, enabled: true }, preset);
    void onUpdateNoiseReduction(next, true);
  };

  const handleThresholdChange = (thresholdDb: number) => {
    schedulePersist({
      ...config,
      preset: "custom",
      thresholdDb,
    });
  };

  const handleHighPassChange = (highPassHz: number) => {
    schedulePersist({
      ...config,
      preset: "custom",
      highPassHz,
    });
  };

  const handleToggleWebrtcNs = (webrtcNoiseSuppression: boolean) => {
    void onUpdateNoiseReduction(
      {
        ...config,
        webrtcNoiseSuppression,
      },
      true
    );
  };

  const handleResetDefaults = () => {
    void onUpdateNoiseReduction(DEFAULT_NOISE_REDUCTION_CONFIG, true);
  };

  const levelPct = dbToPercent(inputDb);
  const thresholdPct = dbToPercent(config.thresholdDb);
  const formattedDb =
    inputDb <= MIN_DB_FLOOR + 1 ? "-∞ dB" : `${Math.round(inputDb)} dB`;

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
        className="no-scrollbar"
        style={{
          width: "100%",
          maxWidth: "500px",
          maxHeight: "90%",
          overflowY: "auto",
          background: "#2b2d31",
          borderRadius: "10px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
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
            Redutor de Ruído &amp; Áudio
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

        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "12px",
            borderRadius: "8px",
            background: "#1e1f22",
            fontSize: "14px",
            fontWeight: 600,
            color: "#f2f3f5",
            cursor: "pointer",
          }}
        >
          <span>Ativar redutor de ruído do microfone</span>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
            style={{ width: "18px", height: "18px", cursor: "pointer" }}
          />
        </label>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#b5bac1",
              }}
            >
              PERFIL DE REDUÇÃO
            </span>
            {config.preset === "custom" && (
              <span
                style={{
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  background: "#5865f2",
                  color: "#ffffff",
                  fontWeight: 600,
                }}
              >
                Personalizado
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "8px",
            }}
          >
            {(
              Object.keys(NOISE_REDUCTION_PRESETS) as Array<
                Exclude<NoiseReductionPreset, "custom">
              >
            ).map((presetKey) => {
              const spec = NOISE_REDUCTION_PRESETS[presetKey];
              const isSelected = config.preset === presetKey;
              return (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => handleSelectPreset(presetKey)}
                  style={{
                    padding: "10px 8px",
                    borderRadius: "6px",
                    border: isSelected
                      ? "1px solid #5865f2"
                      : "1px solid #3f4147",
                    background: isSelected
                      ? "rgba(88, 101, 242, 0.2)"
                      : "#1e1f22",
                    color: "#f2f3f5",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 700 }}>
                    {spec.label}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#b5bac1",
                      marginTop: "2px",
                    }}
                  >
                    {spec.thresholdDb} dB
                  </div>
                </button>
              );
            })}
          </div>
          {config.preset !== "custom" && (
            <div style={{ fontSize: "12px", color: "#949ba4", marginTop: "6px" }}>
              {NOISE_REDUCTION_PRESETS[config.preset].description}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px",
            borderRadius: "8px",
            background: "#1e1f22",
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
              fontSize: "12px",
            }}
          >
            <span style={{ color: "#b5bac1", fontWeight: 600 }}>
              MEDIDOR DE ENTRADA ({formattedDb})
            </span>
            <span
              style={{
                fontWeight: 700,
                color: !config.enabled
                  ? "#b5bac1"
                  : gateOpen
                  ? "#23a55a"
                  : "#949ba4",
              }}
            >
              {!config.enabled
                ? "Desativado (sem corte)"
                : gateOpen
                ? "Voz captada (aberto)"
                : "Ruído bloqueado (fechado)"}
            </span>
          </div>

          <div
            style={{
              position: "relative",
              height: "14px",
              borderRadius: "7px",
              background: "#111214",
              overflow: "hidden",
              border: "1px solid #3f4147",
            }}
          >
            <div
              style={{
                width: `${levelPct}%`,
                height: "100%",
                background: !config.enabled
                  ? "#5865f2"
                  : gateOpen
                  ? "#23a55a"
                  : "#6d6f78",
                transition: "width 40ms linear",
              }}
            />
            {config.enabled && (
              <div
                title={`Limiar: ${config.thresholdDb} dB`}
                style={{
                  position: "absolute",
                  left: `${thresholdPct}%`,
                  top: 0,
                  bottom: 0,
                  width: "2px",
                  background: "#f0b232",
                  boxShadow: "0 0 4px rgba(240, 178, 50, 0.9)",
                }}
              />
            )}
          </div>

          {micPreviewError && (
            <div style={{ fontSize: "11px", color: "#f0b232" }}>
              {micPreviewError}
            </div>
          )}
        </div>

        <div style={{ opacity: config.enabled ? 1 : 0.5 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              fontWeight: 600,
              color: "#b5bac1",
              marginBottom: "6px",
            }}
          >
            <span>SENSIBILIDADE / LIMIAR (NOISE GATE)</span>
            <span style={{ color: "#f2f3f5" }}>{config.thresholdDb} dB</span>
          </div>
          <input
            type="range"
            min={NOISE_THRESHOLD_MIN_DB}
            max={NOISE_THRESHOLD_MAX_DB}
            step={1}
            disabled={!config.enabled}
            value={config.thresholdDb}
            onChange={(e) => handleThresholdChange(Number(e.target.value))}
            style={{
              width: "100%",
              cursor: config.enabled ? "pointer" : "not-allowed",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "11px",
              color: "#949ba4",
            }}
          >
            <span>Mais sensível ({NOISE_THRESHOLD_MIN_DB} dB)</span>
            <span>Mais agressivo ({NOISE_THRESHOLD_MAX_DB} dB)</span>
          </div>
        </div>

        <div style={{ opacity: config.enabled ? 1 : 0.5 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              fontWeight: 600,
              color: "#b5bac1",
              marginBottom: "6px",
            }}
          >
            <span>FILTRO DE GRAVES (VENTILADOR / MESA)</span>
            <span style={{ color: "#f2f3f5" }}>
              {config.highPassHz === 0 ? "Desligado" : `${config.highPassHz} Hz`}
            </span>
          </div>
          <input
            type="range"
            min={NOISE_HIGHPASS_MIN_HZ}
            max={NOISE_HIGHPASS_MAX_HZ}
            step={5}
            disabled={!config.enabled}
            value={config.highPassHz}
            onChange={(e) => handleHighPassChange(Number(e.target.value))}
            style={{
              width: "100%",
              cursor: config.enabled ? "pointer" : "not-allowed",
            }}
          />
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            color: config.enabled ? "#dbdee1" : "#6d6f78",
            cursor: config.enabled ? "pointer" : "not-allowed",
          }}
        >
          <input
            type="checkbox"
            disabled={!config.enabled}
            checked={config.webrtcNoiseSuppression}
            onChange={(e) => handleToggleWebrtcNs(e.target.checked)}
          />
          Combinar com supressão de ruído nativa (WebRTC)
        </label>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
            marginTop: "4px",
          }}
        >
          <button
            type="button"
            onClick={handleResetDefaults}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #3f4147",
              background: "transparent",
              color: "#b5bac1",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Restaurar Padrão
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: "#5865f2",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
