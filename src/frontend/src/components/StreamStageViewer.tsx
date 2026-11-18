import type { RemoteTrack } from "livekit-client";
import React, { useEffect, useRef, useState } from "react";
import { useRoomStore } from "../stores/roomStore";

export const StreamStageViewer: React.FC = () => {
  const remoteStreams = useRoomStore((s) => s.remoteStreams);
  const selectedStreamKey = useRoomStore((s) => s.selectedStreamKey);
  const setSelectedStreamKey = useRoomStore((s) => s.setSelectedStreamKey);
  const [viewMode, setViewMode] = useState<"default" | "theater">("default");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activeStream =
    remoteStreams.find((s) => s.streamKey === selectedStreamKey) ??
    remoteStreams[0] ??
    null;

  useEffect(() => {
    const videoEl = videoRef.current;
    const track = (activeStream?.videoTrack ?? null) as RemoteTrack | null;
    if (!videoEl || !track) {
      return;
    }

    track.attach(videoEl);
    return () => {
      track.detach(videoEl);
    };
  }, [activeStream]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  };

  if (remoteStreams.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#949ba4",
          gap: "8px",
          padding: "24px",
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
          {remoteStreams.map((stream) => {
            const isSelected = stream.streamKey === activeStream?.streamKey;
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
          background: "#000000",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>
    </div>
  );
};
