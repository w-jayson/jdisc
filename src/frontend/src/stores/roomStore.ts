import { create } from "zustand";
import type { RoomSummaryDto } from "../services/api/roomsApi";
import type {
  StreamAudioMode,
  StreamLifecycleStatus,
  StreamPreset,
} from "../services/desktop/types";

export interface RemoteScreenShareStream {
  streamKey: string;
  ownerUserId: string;
  ownerDisplayName: string;
  companionIdentity: string;
  hasAudio: boolean;
  videoTrack: unknown | null;
  audioTrack: unknown | null;
}

interface RoomState {
  rooms: RoomSummaryDto[];
  activeRoomId: string | null;
  activeRoomName: string | null;
  activeLivekitUrl: string | null;
  callConnectionState:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting";
  isMicMuted: boolean;
  isDeafened: boolean;
  activeSpeakerIds: string[];
  remoteStreams: RemoteScreenShareStream[];
  selectedStreamKey: string | null;
  localStreamStatus: StreamLifecycleStatus;
  localStreamPreset: StreamPreset;
  localStreamAudioMode: StreamAudioMode;
  localStreamWarning: string | null;
  setRooms: (rooms: RoomSummaryDto[]) => void;
  updateParticipantAudioState: (
    roomId: string,
    userId: string,
    isMicMuted: boolean,
    isDeafened: boolean
  ) => void;
  setActiveCall: (
    roomId: string | null,
    roomName: string | null,
    livekitUrl: string | null
  ) => void;
  setCallConnectionState: (
    state: "disconnected" | "connecting" | "connected" | "reconnecting"
  ) => void;
  setLocalAudioFlags: (isMicMuted: boolean, isDeafened: boolean) => void;
  setActiveSpeakerIds: (speakerIds: string[]) => void;
  setRemoteStreams: (streams: RemoteScreenShareStream[]) => void;
  setSelectedStreamKey: (streamKey: string | null) => void;
  setLocalStreamState: (partial: {
    status?: StreamLifecycleStatus;
    preset?: StreamPreset;
    audioMode?: StreamAudioMode;
    warning?: string | null;
  }) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  rooms: [],
  activeRoomId: null,
  activeRoomName: null,
  activeLivekitUrl: null,
  callConnectionState: "disconnected",
  isMicMuted: false,
  isDeafened: false,
  activeSpeakerIds: [],
  remoteStreams: [],
  selectedStreamKey: null,
  localStreamStatus: "idle",
  localStreamPreset: "720p30",
  localStreamAudioMode: "process_tree",
  localStreamWarning: null,
  setRooms: (rooms) => set({ rooms }),
  updateParticipantAudioState: (roomId, userId, isMuted, isDeafened) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.id !== roomId
          ? room
          : {
              ...room,
              participants: room.participants.map((p) =>
                p.userId !== userId ? p : { ...p, isMuted, isDeafened }
              ),
            }
      ),
    })),
  setActiveCall: (activeRoomId, activeRoomName, activeLivekitUrl) =>
    set({ activeRoomId, activeRoomName, activeLivekitUrl }),
  setCallConnectionState: (callConnectionState) =>
    set({ callConnectionState }),
  setLocalAudioFlags: (isMicMuted, isDeafened) =>
    set({ isMicMuted, isDeafened }),
  setActiveSpeakerIds: (activeSpeakerIds) => set({ activeSpeakerIds }),
  setRemoteStreams: (remoteStreams) =>
    set((state) => {
      const stillExists = remoteStreams.some(
        (s) => s.streamKey === state.selectedStreamKey
      );
      const nextSelected = stillExists
        ? state.selectedStreamKey
        : remoteStreams[0]?.streamKey ?? null;
      return { remoteStreams, selectedStreamKey: nextSelected };
    }),
  setSelectedStreamKey: (selectedStreamKey) => set({ selectedStreamKey }),
  setLocalStreamState: (partial) =>
    set((state) => ({
      localStreamStatus: partial.status ?? state.localStreamStatus,
      localStreamPreset: partial.preset ?? state.localStreamPreset,
      localStreamAudioMode: partial.audioMode ?? state.localStreamAudioMode,
      localStreamWarning:
        partial.warning !== undefined
          ? partial.warning
          : state.localStreamWarning,
    })),
}));
