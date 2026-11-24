import { create } from "zustand";
import type { RoomSummaryDto } from "../services/api/roomsApi";
import type {
  StreamAspectMode,
  StreamAudioMode,
  StreamLifecycleStatus,
  StreamPreset,
} from "../services/desktop/types";

export const LOCAL_PREVIEW_STREAM_KEY = "__local_preview__";

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
  localStreamAspectMode: StreamAspectMode;
  localStreamWarning: string | null;
  localStreamSourceTitle: string | null;
  localStreamPreviewUrl: string | null;
  localStreamPreviewEnabled: boolean;
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
    aspectMode?: StreamAspectMode;
    warning?: string | null;
    sourceTitle?: string | null;
  }) => void;
  setLocalStreamAspectMode: (mode: StreamAspectMode) => void;
  setLocalStreamPreviewUrl: (url: string | null) => void;
  setLocalStreamPreviewEnabled: (enabled: boolean) => void;
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
  localStreamAspectMode: "original",
  localStreamWarning: null,
  localStreamSourceTitle: null,
  localStreamPreviewUrl: null,
  localStreamPreviewEnabled: true,
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
      const isLocalActive =
        state.localStreamStatus === "streaming" ||
        state.localStreamStatus === "starting";
      const keepingLocalPreview =
        isLocalActive && state.selectedStreamKey === LOCAL_PREVIEW_STREAM_KEY;
      const stillExists =
        keepingLocalPreview ||
        remoteStreams.some((s) => s.streamKey === state.selectedStreamKey);
      const nextSelected = stillExists
        ? state.selectedStreamKey
        : remoteStreams[0]?.streamKey ??
          (isLocalActive ? LOCAL_PREVIEW_STREAM_KEY : null);
      return { remoteStreams, selectedStreamKey: nextSelected };
    }),
  setSelectedStreamKey: (selectedStreamKey) => set({ selectedStreamKey }),
  setLocalStreamState: (partial) =>
    set((state) => {
      const nextStatus = partial.status ?? state.localStreamStatus;
      const isStoppingOrEnded =
        nextStatus === "idle" || nextStatus === "error";
      const nextSelected =
        isStoppingOrEnded &&
        state.selectedStreamKey === LOCAL_PREVIEW_STREAM_KEY
          ? state.remoteStreams[0]?.streamKey ?? null
          : nextStatus === "starting" && !state.selectedStreamKey
          ? LOCAL_PREVIEW_STREAM_KEY
          : state.selectedStreamKey;

      return {
        localStreamStatus: nextStatus,
        localStreamPreset: partial.preset ?? state.localStreamPreset,
        localStreamAudioMode: partial.audioMode ?? state.localStreamAudioMode,
        localStreamAspectMode: partial.aspectMode ?? state.localStreamAspectMode,
        localStreamWarning:
          partial.warning !== undefined
            ? partial.warning
            : state.localStreamWarning,
        localStreamSourceTitle: isStoppingOrEnded
          ? null
          : partial.sourceTitle !== undefined
          ? partial.sourceTitle
          : state.localStreamSourceTitle,
        localStreamPreviewUrl: isStoppingOrEnded
          ? null
          : state.localStreamPreviewUrl,
        localStreamPreviewEnabled:
          nextStatus === "starting" ? true : state.localStreamPreviewEnabled,
        selectedStreamKey: nextSelected,
      };
    }),
  setLocalStreamAspectMode: (localStreamAspectMode) =>
    set({ localStreamAspectMode }),
  setLocalStreamPreviewUrl: (localStreamPreviewUrl) =>
    set({ localStreamPreviewUrl }),
  setLocalStreamPreviewEnabled: (localStreamPreviewEnabled) =>
    set({ localStreamPreviewEnabled }),
}));
