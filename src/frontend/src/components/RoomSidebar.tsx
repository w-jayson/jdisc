import React from "react";
import { useAuthStore } from "../stores/authStore";
import { useDesktopSettingsStore } from "../stores/desktopSettingsStore";
import { useRoomStore } from "../stores/roomStore";

interface RoomSidebarProps {
  onJoinRoom: (roomId: string) => void;
  onUpdateParticipantVolume: (userId: string, volume: number) => void;
  onOpenShortcutSettings: () => void;
}

export const RoomSidebar: React.FC<RoomSidebarProps> = ({
  onJoinRoom,
  onUpdateParticipantVolume,
  onOpenShortcutSettings,
}) => {
  const rooms = useRoomStore((s) => s.rooms);
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const activeSpeakerIds = useRoomStore((s) => s.activeSpeakerIds);
  const localUserId = useAuthStore((s) => s.session?.userId);
  const displayName = useAuthStore((s) => s.session?.displayName);
  const logout = useAuthStore((s) => s.logout);
  const participantVolumes = useDesktopSettingsStore(
    (s) => s.settings.participantVolumes
  );

  return (
    <aside
      style={{
        width: "clamp(200px, 24vw, 280px)",
        flexShrink: 0,
        height: "100%",
        minHeight: 0,
        background: "#2b2d31",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #1e1f22",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px",
          borderBottom: "1px solid #1e1f22",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong style={{ fontSize: "15px", color: "#f2f3f5" }}>
          Canais de Voz
        </strong>
        <button
          type="button"
          onClick={onOpenShortcutSettings}
          title="Configurar Atalhos Globais (Toggle Mute / Push-to-Talk)"
          style={{
            padding: "4px 8px",
            fontSize: "11px",
            background: "#383a40",
            color: "#dbdee1",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Atalhos
        </button>
      </div>

      <div
        className="no-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "12px 8px",
        }}
      >
        {rooms.map((room) => {
          const isCurrentRoom = room.id === activeRoomId;
          const activeCount = room.participants.length;
          const isFull =
            activeCount >= room.maxParticipants && !isCurrentRoom;

          return (
            <div key={room.id} style={{ marginBottom: "10px" }}>
              <button
                type="button"
                disabled={isFull}
                onClick={() => onJoinRoom(room.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "none",
                  background: isCurrentRoom ? "#404249" : "transparent",
                  color: isFull ? "#6d6f78" : "#f2f3f5",
                  cursor: isFull ? "not-allowed" : "pointer",
                  textAlign: "left",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  🔊 {room.name}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 6px",
                    borderRadius: "10px",
                    background: isFull ? "#da373c" : "#1e1f22",
                    color: "#dbdee1",
                  }}
                >
                  {activeCount}/{room.maxParticipants}
                </span>
              </button>

              {room.participants.length > 0 && (
                <div
                  style={{
                    paddingLeft: "18px",
                    marginTop: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {room.participants.map((p) => {
                    const isSpeaking = activeSpeakerIds.includes(p.userId);
                    const isSelf = p.userId === localUserId;
                    const userVol = participantVolumes[p.userId] ?? 100;

                    return (
                      <div
                        key={p.userId}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "6px",
                          background: "#232428",
                          border: isSpeaking
                            ? "1px solid #23a55a"
                            : "1px solid transparent",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "13px",
                          }}
                        >
                          <span
                            style={{
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: isSpeaking ? "#23a55a" : "#dbdee1",
                              fontWeight: isSpeaking ? 700 : 500,
                            }}
                          >
                            {p.displayName} {isSelf ? "(Você)" : ""}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              gap: "4px",
                              alignItems: "center",
                              fontSize: "11px",
                            }}
                          >
                            {p.isMuted && <span title="Mutado">🔇</span>}
                            {p.isDeafened && (
                              <span title="Ensurdecido">🎧🚫</span>
                            )}
                            {p.isScreenSharing && (
                              <span
                                style={{
                                  background: "#da373c",
                                  color: "#ffffff",
                                  padding: "1px 5px",
                                  borderRadius: "4px",
                                  fontWeight: 700,
                                  fontSize: "10px",
                                }}
                              >
                                AO VIVO {p.screenShareHasAudio ? "🔊" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        {!isSelf && isCurrentRoom && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              marginTop: "4px",
                            }}
                          >
                            <span style={{ fontSize: "10px", color: "#949ba4" }}>
                              Vol {userVol}%
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={200}
                              value={userVol}
                              onChange={(e) =>
                                onUpdateParticipantVolume(
                                  p.userId,
                                  Number(e.target.value)
                                )
                              }
                              style={{ flex: 1, cursor: "pointer" }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: "12px",
          background: "#232428",
          borderTop: "1px solid #1e1f22",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          style={{
            padding: "4px 8px",
            fontSize: "11px",
            background: "transparent",
            color: "#f23f43",
            border: "1px solid #f23f43",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Sair
        </button>
      </div>
    </aside>
  );
};
