import React, { useState } from "react";
import { saveAppSettings } from "../services/desktop/settingsService";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";

export const ServerConnectionForm: React.FC = () => {
  const serverUrl = useDesktopSettingsStore((s) => s.settings.serverUrl);
  const setServerUrl = useDesktopSettingsStore((s) => s.setServerUrl);
  const [draftUrl, setDraftUrl] = useState(serverUrl);
  const [savedNotice, setSavedNotice] = useState(false);

  React.useEffect(() => {
    setDraftUrl(serverUrl);
  }, [serverUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftUrl.trim().replace(/\/+$/, "").replace(/\/api(\/.*)?$/i, "");
    setDraftUrl(cleaned);
    setServerUrl(cleaned);
    const updated = useDesktopSettingsStore.getState().settings;
    await saveAppSettings(updated);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        background: "#1e1f22",
        borderRadius: "8px",
        border: "1px solid #2b2d31",
      }}
    >
      <label
        htmlFor="server-url-input"
        style={{ fontSize: "12px", fontWeight: 600, color: "#b5bac1" }}
      >
        ENDEREÇO DO SERVIDOR JDISC
      </label>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          id="server-url-input"
          type="url"
          required
          value={draftUrl}
          onChange={(e) => {
            setDraftUrl(e.target.value);
            setServerUrl(
              e.target.value.trim().replace(/\/+$/, "").replace(/\/api(\/.*)?$/i, "")
            );
          }}
          placeholder="http://localhost:5000"
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: "4px",
            border: "1px solid #3f4147",
            background: "#111214",
            color: "#f2f3f5",
            fontSize: "13px",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "8px 12px",
            borderRadius: "4px",
            border: "none",
            background: "#4e5058",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Salvar URL
        </button>
      </div>
      {savedNotice && (
        <span style={{ fontSize: "11px", color: "#23a55a" }}>
          URL do servidor salva localmente.
        </span>
      )}
    </form>
  );
};
