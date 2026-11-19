import React from "react";
import type { AppUpdaterState } from "../hooks/useAppUpdater";

interface AppUpdateBannerProps {
  updater: AppUpdaterState;
}

export const AppUpdateBanner: React.FC<AppUpdateBannerProps> = ({ updater }) => {
  const {
    status,
    availableVersion,
    currentVersion,
    progressPercent,
    error,
    installUpdate,
    dismissUpdate,
  } = updater;

  if (status === "idle") {
    return null;
  }

  const isBusy = status === "downloading" || status === "installing";

  return (
    <div
      role="status"
      style={{
        padding: "8px 16px",
        background: status === "error" ? "#da373c" : "#5865f2",
        color: "#ffffff",
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <strong style={{ fontWeight: 700 }}>
          {status === "error" ? "Erro na atualização:" : `Atualização v${availableVersion} disponível`}
        </strong>
        {status === "available" && currentVersion && (
          <span style={{ opacity: 0.9 }}>
            (versão atual: v{currentVersion})
          </span>
        )}
        {status === "downloading" && (
          <span style={{ opacity: 0.95 }}>
            Baixando atualização{progressPercent !== null ? ` (${progressPercent}%)` : "..."}
          </span>
        )}
        {status === "installing" && (
          <span style={{ opacity: 0.95 }}>Instalando e reiniciando o jdisc...</span>
        )}
        {status === "error" && error && <span style={{ opacity: 0.95 }}>{error}</span>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        {(status === "available" || status === "error") && (
          <button
            type="button"
            onClick={() => void installUpdate()}
            style={{
              background: "#ffffff",
              color: status === "error" ? "#da373c" : "#4752c4",
              border: "none",
              borderRadius: "4px",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {status === "error" ? "Tentar novamente" : "Atualizar agora"}
          </button>
        )}

        {!isBusy && (
          <button
            type="button"
            onClick={dismissUpdate}
            style={{
              background: "transparent",
              color: "#ffffff",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: "4px",
              padding: "4px 8px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Depois
          </button>
        )}
      </div>
    </div>
  );
};
