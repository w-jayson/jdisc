import React, { useState } from "react";
import { loginUser, registerUser } from "../services/api/authApi";
import { useAuthStore } from "../stores/authStore";
import { ServerConnectionForm } from "./ServerConnectionForm";

export const AuthScreen: React.FC = () => {
  const setSession = useAuthStore((s) => s.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response =
        mode === "login"
          ? await loginUser(email.trim(), password)
          : await registerUser(
              displayName.trim(),
              email.trim(),
              password,
              inviteCode.trim()
            );

      await setSession({
        accessToken: response.accessToken,
        expiresAt: response.expiresAt,
        userId: response.user.id,
        displayName: response.user.displayName,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao autenticar no servidor jdisc."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="no-scrollbar"
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#111214",
        padding: "16px",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <div
        style={{
          margin: "auto",
          width: "100%",
          maxWidth: "420px",
          background: "#2b2d31",
          borderRadius: "10px",
          padding: "clamp(16px, 3vw, 24px)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "22px", color: "#f2f3f5" }}>
            jdisc Desktop
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#b5bac1" }}>
            Voz em tempo real + transmissão nativa 1080p60 com áudio por processo
          </p>
        </div>

        <ServerConnectionForm />

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: "4px",
              border: "none",
              background: mode === "login" ? "#5865f2" : "#1e1f22",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: "4px",
              border: "none",
              background: mode === "register" ? "#5865f2" : "#1e1f22",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Criar Conta (Convite)
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {mode === "register" && (
            <div>
              <label
                htmlFor="display-name-input"
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#b5bac1",
                  marginBottom: "4px",
                }}
              >
                NOME DE EXIBIÇÃO (2–32 CARACTERES)
              </label>
              <input
                id="display-name-input"
                type="text"
                required
                minLength={2}
                maxLength={32}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "4px",
                  border: "1px solid #1e1f22",
                  background: "#1e1f22",
                  color: "#f2f3f5",
                }}
              />
            </div>
          )}

          <div>
            <label
              htmlFor="email-input"
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "#b5bac1",
                marginBottom: "4px",
              }}
            >
              E-MAIL
            </label>
            <input
              id="email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "4px",
                border: "1px solid #1e1f22",
                background: "#1e1f22",
                color: "#f2f3f5",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password-input"
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "#b5bac1",
                marginBottom: "4px",
              }}
            >
              SENHA (MÍNIMO 6 CARACTERES)
            </label>
            <input
              id="password-input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "4px",
                border: "1px solid #1e1f22",
                background: "#1e1f22",
                color: "#f2f3f5",
              }}
            />
          </div>

          {mode === "register" && (
            <div>
              <label
                htmlFor="invite-code-input"
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#b5bac1",
                  marginBottom: "4px",
                }}
              >
                CÓDIGO DE CONVITE DO SERVIDOR
              </label>
              <input
                id="invite-code-input"
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "4px",
                  border: "1px solid #1e1f22",
                  background: "#1e1f22",
                  color: "#f2f3f5",
                }}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                padding: "10px",
                borderRadius: "4px",
                background: "rgba(218, 55, 60, 0.15)",
                border: "1px solid #da373c",
                color: "#f23f43",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "11px",
              borderRadius: "4px",
              border: "none",
              background: "#23a55a",
              color: "#ffffff",
              fontWeight: 700,
              cursor: loading ? "wait" : "pointer",
              marginTop: "4px",
            }}
          >
            {loading
              ? "Processando..."
              : mode === "login"
              ? "Entrar no Servidor"
              : "Registrar e Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
};
