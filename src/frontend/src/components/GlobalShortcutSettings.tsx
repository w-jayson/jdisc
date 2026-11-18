import React, { useState } from "react";
import {
  registerGlobalShortcut,
  unregisterGlobalShortcut,
} from "../services/desktop/shortcutService";
import type { GlobalShortcutConfig, ShortcutMode } from "../services/desktop/types";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";

interface GlobalShortcutSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatKeyboardEventToAccelerator(e: React.KeyboardEvent): string | null {
  const ignoredKeys = new Set(["Control", "Shift", "Alt", "Meta"]);
  if (ignoredKeys.has(e.key)) {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  const keyName =
    e.key === " "
      ? "Space"
      : e.key.length === 1
      ? e.key.toUpperCase()
      : e.key;

  parts.push(keyName);
  return parts.join("+");
}

export const GlobalShortcutSettings: React.FC<GlobalShortcutSettingsProps> = ({
  isOpen,
  onClose,
}) => {
  const currentConfig = useDesktopSettingsStore(
    (s) => s.settings.globalShortcut
  );
  const setGlobalShortcut = useDesktopSettingsStore((s) => s.setGlobalShortcut);

  const [enabled, setEnabled] = useState(currentConfig.enabled);
  const [mode, setMode] = useState<ShortcutMode>(currentConfig.mode);
  const [accelerator, setAccelerator] = useState<string>(
    currentConfig.accelerator ?? "CommandOrControl+Shift+M"
  );
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleSave = async () => {
    setError(null);
    setSavedMsg(null);

    const nextConfig: GlobalShortcutConfig = {
      enabled,
      mode,
      accelerator: accelerator.trim() || null,
    };

    try {
      if (enabled && nextConfig.accelerator) {
        await registerGlobalShortcut(nextConfig);
      } else {
        await unregisterGlobalShortcut();
      }
      setGlobalShortcut(nextConfig);
      setSavedMsg("Atalho global salvo com sucesso.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === "string"
          ? err
          : "Conflito ao registrar atalho global no Windows."
      );
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
        className="no-scrollbar"
        style={{
          width: "100%",
          maxWidth: "480px",
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
            Atalhos Globais em 2º Plano
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
            gap: "8px",
            fontSize: "14px",
            color: "#f2f3f5",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Habilitar atalho global (funciona durante jogos em tela cheia)
        </label>

        <div>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              color: "#b5bac1",
              marginBottom: "6px",
            }}
          >
            MODO DE OPERAÇÃO DO MICROFONE
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ShortcutMode)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "6px",
              background: "#1e1f22",
              color: "#f2f3f5",
              border: "1px solid #3f4147",
            }}
          >
            <option value="toggle">Alternar Mute (Toggle Mute)</option>
            <option value="push_to_talk">
              Pressionar para Falar (Push-to-Talk)
            </option>
          </select>
        </div>

        <div>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              color: "#b5bac1",
              marginBottom: "6px",
            }}
          >
            COMBINAÇÃO DE TECLAS
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              readOnly
              value={
                recording ? "Pressione as teclas desejadas..." : accelerator
              }
              onKeyDown={(e) => {
                if (!recording) return;
                e.preventDefault();
                const formatted = formatKeyboardEventToAccelerator(e);
                if (formatted) {
                  setAccelerator(formatted);
                  setRecording(false);
                }
              }}
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: "6px",
                border: recording ? "1px solid #5865f2" : "1px solid #3f4147",
                background: "#1e1f22",
                color: "#f2f3f5",
              }}
            />
            <button
              type="button"
              onClick={() => setRecording((r) => !r)}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "none",
                background: recording ? "#da373c" : "#5865f2",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {recording ? "Cancelar" : "Gravar Tecla"}
            </button>
          </div>
        </div>

        <div
          style={{
            fontSize: "12px",
            color: "#b5bac1",
            background: "#1e1f22",
            padding: "10px",
            borderRadius: "6px",
            lineHeight: 1.4,
          }}
        >
          💡 Nota do Windows (UIPI): Se o jogo em tela cheia estiver rodando como{" "}
          <strong>Administrador</strong>, execute também o jdisc como
          Administrador para que o Windows entregue eventos de teclado ao app em
          segundo plano.
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 10px",
              borderRadius: "6px",
              background: "rgba(218, 55, 60, 0.15)",
              border: "1px solid #da373c",
              color: "#f23f43",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        {savedMsg && (
          <div style={{ fontSize: "12px", color: "#23a55a" }}>{savedMsg}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: "#4e5058",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: "#23a55a",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Salvar Atalho
          </button>
        </div>
      </div>
    </div>
  );
};
