import type { RemoteTrack } from "livekit-client";
import React, { useEffect, useRef, useState } from "react";
import { setStreamPreviewEnabled } from "../services/desktop/captureService";
import { LOCAL_PREVIEW_STREAM_KEY, useRoomStore } from "../stores/roomStore";

export const StreamStageViewer: React.FC = () => {
  const remoteStreams = useRoomStore((s) => s.remoteStreams);
  const selectedStreamKey = useRoomStore((s) => s.selectedStreamKey);
  const setSelectedStreamKey = useRoomStore((s) => s.setSelectedStreamKey);
  const localStreamStatus = useRoomStore((s) => s.localStreamStatus);
  const localStreamSourceTitle = useRoomStore((s) => s.localStreamSourceTitle);
  const localStreamPreviewUrl = useRoomStore((s) => s.localStreamPreviewUrl);
  const localStreamPreviewEnabled = useRoomStore(
    (s) => s.localStreamPreviewEnabled
  );
  const setLocalStreamPreviewEnabled = useRoomStore(
    (s) => s.setLocalStreamPreviewEnabled
  );
  const [viewMode, setViewMode] = useState<"default" | "theater">("default");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const isLocalStreamActive =
    localStreamStatus === "streaming" || localStreamStatus === "starting";

  const isShowingLocalPreview =
    isLocalStreamActive &&
    (selectedStreamKey === LOCAL_PREVIEW_STREAM_KEY ||
      remoteStreams.length === 0);

  const activeRemoteStream = isShowingLocalPreview
    ? null
    : remoteStreams.find((s) => s.streamKey === selectedStreamKey) ??
      remoteStreams[0] ??
      null;

  // Pause low-res preview encoding in Rust whenever preview is hidden or another stream is focused
  useEffect(() => {
    if (!isLocalStreamActive) {
      return;
    }
    const shouldEncodePreview =
      isShowingLocalPreview && localStreamPreviewEnabled;
    void setStreamPreviewEnabled(shouldEncodePreview);
  }, [isLocalStreamActive, isShowingLocalPreview, localStreamPreviewEnabled]);

  useEffect(() => {
    const videoEl = videoRef.current;
    const track = (activeRemoteStream?.videoTrack ?? null) as RemoteTrack | null;
    if (!videoEl || !track) {
      return;
    }

    track.attach(videoEl);
    return () => {
      track.detach(videoEl);
    };
  }, [activeRemoteStream]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  };

  if (remoteStreams.length === 0 && !isLocalStreamActive) {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          color: "#949ba4",
          gap: "8px",
          padding: "24px",
          overflow: "hidden",
        }}
      >
        <div style={{ fontSize: "36px" }}>📺</div>
        <div style={{ fontSize: "15px", fontWeight: 600, color: "#dbdee1" }}>
          Nenhuma transmissão de tela ativa no momento
        </div>
        <div style={{ fontSize: "13px" }}>
          Quando um participante iniciar um compartilhamento de tela ou jogo, ele
          aparecerá aqui automaticamente.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "#111214",
        padding: viewMode === "theater" ? "4px" : "16px",
        gap: "12px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {isLocalStreamActive && (
            <button
              type="button"
              onClick={() => setSelectedStreamKey(LOCAL_PREVIEW_STREAM_KEY)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: isShowingLocalPreview
                  ? "1px solid #9b59b6"
                  : "1px solid #2b2d31",
                background: isShowingLocalPreview ? "#71368a" : "#2b2d31",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🟣 Sua Tela (Preview)
            </button>
          )}

          {remoteStreams.map((stream) => {
            const isSelected =
              !isShowingLocalPreview &&
              stream.streamKey === activeRemoteStream?.streamKey;
            return (
              <button
                key={stream.streamKey}
                type="button"
                onClick={() => setSelectedStreamKey(stream.streamKey)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: isSelected
                    ? "1px solid #5865f2"
                    : "1px solid #2b2d31",
                  background: isSelected ? "#5865f2" : "#2b2d31",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                🔴 {stream.ownerDisplayName}{" "}
                {stream.hasAudio ? "🔊" : "(Sem Áudio)"}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {isShowingLocalPreview && (
            <button
              type="button"
              onClick={() =>
                setLocalStreamPreviewEnabled(!localStreamPreviewEnabled)
              }
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "none",
                background: localStreamPreviewEnabled ? "#2b2d31" : "#5865f2",
                color: "#dbdee1",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {localStreamPreviewEnabled
                ? "🙈 Ocultar Preview"
                : "👁️ Mostrar Preview"}
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              setViewMode((prev) =>
                prev === "default" ? "theater" : "default"
              )
            }
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "none",
              background: "#2b2d31",
              color: "#dbdee1",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {viewMode === "default" ? "Modo Teatro" : "Modo Padrão"}
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "none",
              background: "#2b2d31",
              color: "#dbdee1",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            ⛶ Tela Cheia
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          background: "#000000",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {isShowingLocalPreview ? (
          localStreamPreviewEnabled ? (
            <>
              {localStreamPreviewUrl ? (
                <img
                  src={localStreamPreviewUrl}
                  alt="Preview local do compartilhamento de tela"
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    userSelect: "none",
                  }}
                />
              ) : (
                <div
                  style={{
                    color: "#949ba4",
                    fontSize: "13px",
                    textAlign: "center",
                    padding: "20px",
                  }}
                >
                  Carregando preview local da sua transmissão...
                </div>
              )}

              <div
                style={{
                  position: "absolute",
                  top: "12px",
                  left: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "5px 10px",
                  borderRadius: "6px",
                  background: "rgba(17, 18, 20, 0.78)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#dbdee1",
                  fontSize: "11px",
                  pointerEvents: "none",
                  maxWidth: "calc(100% - 24px)",
                }}
              >
                <span
                  style={{
                    color: "#c084fc",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  PREVIEW LOCAL • 270p ~4 FPS
                </span>
                {localStreamSourceTitle && (
                  <span
                    style={{
                      color: "#b5bac1",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    — {localStreamSourceTitle}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "10px",
                color: "#949ba4",
                textAlign: "center",
                padding: "24px",
              }}
            >
              <div style={{ fontSize: "28px" }}>🙈</div>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#dbdee1",
                }}
              >
                Preview ocultado para economizar recursos
              </div>
              {localStreamSourceTitle && (
                <div style={{ fontSize: "12px", color: "#b5bac1" }}>
                  Compartilhando: {localStreamSourceTitle}
                </div>
              )}
              <button
                type="button"
                onClick={() => setLocalStreamPreviewEnabled(true)}
                style={{
                  marginTop: "4px",
                  padding: "7px 14px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#5865f2",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                👁️ Mostrar Preview
              </button>
            </div>
          )
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        )}
      </div>
    </div>
  );
};
