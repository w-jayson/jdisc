import {
  ConnectionState,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { useAuthStore } from "../../stores/authStore";
import { useDesktopSettingsStore } from "../../stores/desktopSettingsStore";
import {
  type RemoteScreenShareStream,
  useRoomStore,
} from "../../stores/roomStore";
import {
  playJoinRoomSound,
  playLeaveRoomSound,
} from "../../utils/soundEffects";
import { stopScreenStream } from "../desktop/captureService";
import { signalrService } from "./signalrService";

export const SCREENSHARE_IDENTITY_SUFFIX = ":screenshare";

/**
 * Pure helper that determines whether a remote participant identity/metadata belongs to
 * the local user's own `{userId}:screenshare` companion publisher.
 * We MUST block auto-subscribe and playback on own companion tracks to avoid echo and wasted decoding.
 */
export function isOwnCompanionParticipant(
  participantIdentity: string,
  participantMetadata: string | undefined,
  localUserId: string | null | undefined
): boolean {
  if (!localUserId) {
    return false;
  }

  const normalizedLocal = localUserId.trim().toLowerCase();
  const normalizedIdentity = participantIdentity.trim().toLowerCase();

  if (normalizedIdentity === `${normalizedLocal}${SCREENSHARE_IDENTITY_SUFFIX}`) {
    return true;
  }

  if (participantMetadata) {
    try {
      const parsed = JSON.parse(participantMetadata) as {
        isCompanion?: boolean;
        kind?: string;
        parentUserId?: string;
      };
      if (
        (parsed.isCompanion ||
          parsed.kind?.toLowerCase() === "screenshare") &&
        typeof parsed.parentUserId === "string" &&
        parsed.parentUserId.trim().toLowerCase() === normalizedLocal
      ) {
        return true;
      }
    } catch {
      // Ignore malformed metadata
    }
  }

  return false;
}

export function extractCompanionOwnerId(identity: string): string {
  if (identity.toLowerCase().endsWith(SCREENSHARE_IDENTITY_SUFFIX)) {
    return identity.slice(0, -SCREENSHARE_IDENTITY_SUFFIX.length);
  }
  return identity;
}

interface RemoteVoiceAudioNode {
  element: HTMLAudioElement;
  gainNode: GainNode | null;
}

class LiveKitCallService {
  private room: Room | null = null;
  private audioContext: AudioContext | null = null;
  private voiceAudioNodes = new Map<string, RemoteVoiceAudioNode>();
  private screenAudioElements = new Map<string, HTMLAudioElement>();

  public async connectToVoiceRoom(
    roomId: string,
    roomName: string,
    livekitUrl: string,
    voiceToken: string
  ): Promise<void> {
    if (this.room) {
      await this.disconnectFromVoiceRoom();
    }

    const roomStore = useRoomStore.getState();
    roomStore.setCallConnectionState("connecting");
    roomStore.setActiveCall(roomId, roomName, livekitUrl);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    this.room = room;

    this.registerRoomListeners(room, roomId);

    await room.connect(livekitUrl, voiceToken, {
      autoSubscribe: true,
    });

    await room.localParticipant.setMicrophoneEnabled(true);

    roomStore.setLocalAudioFlags(false, false);
    roomStore.setCallConnectionState("connected");
    playJoinRoomSound();

    // Enforce self-screenshare suppression on any existing participants in the room
    this.enforceSelfCompanionBlockOnAll(room);
    this.rebuildRemoteStreamsList(room);
  }

  public async disconnectFromVoiceRoom(): Promise<void> {
    const roomStore = useRoomStore.getState();
    if (roomStore.localStreamStatus !== "idle") {
      await stopScreenStream();
      roomStore.setLocalStreamState({ status: "idle", warning: null });
    }

    if (this.room) {
      try {
        await this.room.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.room = null;
    }

    this.cleanupAllAudioNodes();
    roomStore.setRemoteStreams([]);
    roomStore.setActiveSpeakerIds([]);
    roomStore.setActiveCall(null, null, null);
    roomStore.setCallConnectionState("disconnected");
    playLeaveRoomSound();
  }

  public async setMicMuted(muted: boolean): Promise<void> {
    const roomStore = useRoomStore.getState();
    let nextDeafened = roomStore.isDeafened;

    // Unmuting while deafened automatically undeafens
    if (!muted && nextDeafened) {
      nextDeafened = false;
    }

    if (this.room) {
      await this.room.localParticipant.setMicrophoneEnabled(!muted);
    }

    roomStore.setLocalAudioFlags(muted, nextDeafened);
    this.applyDeafenAndVolumes();

    if (roomStore.activeRoomId) {
      await signalrService.reportLocalAudioState(
        roomStore.activeRoomId,
        muted,
        nextDeafened
      );
    }
  }

  public async toggleMicMute(): Promise<void> {
    const { isMicMuted } = useRoomStore.getState();
    await this.setMicMuted(!isMicMuted);
  }

  public async toggleDeafen(): Promise<void> {
    const roomStore = useRoomStore.getState();
    const nextDeafened = !roomStore.isDeafened;
    const nextMicMuted = nextDeafened ? true : false;

    if (this.room) {
      await this.room.localParticipant.setMicrophoneEnabled(!nextMicMuted);
    }

    roomStore.setLocalAudioFlags(nextMicMuted, nextDeafened);
    this.applyDeafenAndVolumes();

    if (roomStore.activeRoomId) {
      await signalrService.reportLocalAudioState(
        roomStore.activeRoomId,
        nextMicMuted,
        nextDeafened
      );
    }
  }

  public setParticipantVolume(userId: string, volumePercent: number): void {
    useDesktopSettingsStore.getState().setParticipantVolume(userId, volumePercent);
    this.applyDeafenAndVolumes();
  }

  private registerRoomListeners(room: Room, _roomId: string): void {
    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      const store = useRoomStore.getState();
      if (state === ConnectionState.Connected) {
        store.setCallConnectionState("connected");
      } else if (state === ConnectionState.Reconnecting) {
        store.setCallConnectionState("reconnecting");
      } else if (state === ConnectionState.Disconnected) {
        store.setCallConnectionState("disconnected");
      }
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const ids = speakers.map((s) => extractCompanionOwnerId(s.identity));
      useRoomStore.getState().setActiveSpeakerIds(ids);
    });

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.guardParticipantPublications(participant);
      this.rebuildRemoteStreamsList(room);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.detachVoiceAudio(participant.identity);
      this.detachScreenAudio(participant.identity);
      this.rebuildRemoteStreamsList(room);
    });

    room.on(
      RoomEvent.TrackPublished,
      (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        const localUserId = useAuthStore.getState().session?.userId;
        if (
          isOwnCompanionParticipant(
            participant.identity,
            participant.metadata,
            localUserId
          )
        ) {
          publication.setSubscribed(false);
          return;
        }
        this.rebuildRemoteStreamsList(room);
      }
    );

    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        const localUserId = useAuthStore.getState().session?.userId;
        if (
          isOwnCompanionParticipant(
            participant.identity,
            participant.metadata,
            localUserId
          )
        ) {
          publication.setSubscribed(false);
          return;
        }

        if (
          track.kind === Track.Kind.Audio &&
          publication.source === Track.Source.Microphone
        ) {
          this.attachVoiceAudio(participant.identity, track);
        } else if (
          track.kind === Track.Kind.Audio &&
          publication.source === Track.Source.ScreenShareAudio
        ) {
          this.attachScreenAudio(participant.identity, track);
        }

        this.rebuildRemoteStreamsList(room);
      }
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (
          track.kind === Track.Kind.Audio &&
          publication.source === Track.Source.Microphone
        ) {
          this.detachVoiceAudio(participant.identity);
        } else if (
          track.kind === Track.Kind.Audio &&
          publication.source === Track.Source.ScreenShareAudio
        ) {
          this.detachScreenAudio(participant.identity);
        }
        this.rebuildRemoteStreamsList(room);
      }
    );

    room.on(RoomEvent.TrackUnpublished, () => {
      this.rebuildRemoteStreamsList(room);
    });
  }

  private enforceSelfCompanionBlockOnAll(room: Room): void {
    for (const participant of room.remoteParticipants.values()) {
      this.guardParticipantPublications(participant);
    }
  }

  private guardParticipantPublications(participant: RemoteParticipant): void {
    const localUserId = useAuthStore.getState().session?.userId;
    if (
      isOwnCompanionParticipant(
        participant.identity,
        participant.metadata,
        localUserId
      )
    ) {
      for (const pub of participant.trackPublications.values()) {
        pub.setSubscribed(false);
      }
    }
  }

  private rebuildRemoteStreamsList(room: Room): void {
    const localUserId = useAuthStore.getState().session?.userId;
    const streams: RemoteScreenShareStream[] = [];

    for (const participant of room.remoteParticipants.values()) {
      if (
        isOwnCompanionParticipant(
          participant.identity,
          participant.metadata,
          localUserId
        )
      ) {
        continue;
      }

      let videoTrack: RemoteTrack | null = null;
      let audioTrack: RemoteTrack | null = null;

      for (const pub of participant.trackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare && pub.track) {
          videoTrack = pub.track;
        } else if (pub.source === Track.Source.ScreenShareAudio && pub.track) {
          audioTrack = pub.track;
        }
      }

      if (videoTrack) {
        const ownerUserId = extractCompanionOwnerId(participant.identity);
        const ownerParticipant = room.remoteParticipants.get(ownerUserId);
        const ownerDisplayName =
          ownerParticipant?.name ||
          participant.name?.replace(/\s*\(Tela\)$/i, "") ||
          ownerUserId;

        streams.push({
          streamKey: participant.identity,
          ownerUserId,
          ownerDisplayName,
          companionIdentity: participant.identity,
          hasAudio: Boolean(audioTrack),
          videoTrack,
          audioTrack,
        });
      }
    }

    useRoomStore.getState().setRemoteStreams(streams);
  }

  private attachVoiceAudio(userId: string, track: RemoteTrack): void {
    this.detachVoiceAudio(userId);
    const element = track.attach() as HTMLAudioElement;
    element.autoplay = true;

    let gainNode: GainNode | null = null;
    try {
      const AudioCtx = window.AudioContext;
      if (AudioCtx && element.srcObject instanceof MediaStream) {
        if (!this.audioContext) {
          this.audioContext = new AudioCtx();
        }
        const source = this.audioContext.createMediaStreamSource(
          element.srcObject
        );
        gainNode = this.audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        element.muted = true; // Output via WebAudio GainNode to support 0-200% boost
      }
    } catch {
      gainNode = null;
    }

    this.voiceAudioNodes.set(userId, { element, gainNode });
    this.applyDeafenAndVolumes();
  }

  private detachVoiceAudio(userId: string): void {
    const existing = this.voiceAudioNodes.get(userId);
    if (existing) {
      existing.element.pause();
      existing.element.srcObject = null;
      existing.element.remove();
      this.voiceAudioNodes.delete(userId);
    }
  }

  private attachScreenAudio(companionIdentity: string, track: RemoteTrack): void {
    this.detachScreenAudio(companionIdentity);
    const element = track.attach() as HTMLAudioElement;
    element.autoplay = true;
    this.screenAudioElements.set(companionIdentity, element);
    this.applyDeafenAndVolumes();
  }

  private detachScreenAudio(companionIdentity: string): void {
    const existing = this.screenAudioElements.get(companionIdentity);
    if (existing) {
      existing.pause();
      existing.srcObject = null;
      existing.remove();
      this.screenAudioElements.delete(companionIdentity);
    }
  }

  private applyDeafenAndVolumes(): void {
    const { isDeafened } = useRoomStore.getState();
    const { participantVolumes } = useDesktopSettingsStore.getState().settings;

    for (const [userId, node] of this.voiceAudioNodes.entries()) {
      const rawPct = participantVolumes[userId] ?? 100;
      const gainValue = isDeafened ? 0 : Math.max(0, Math.min(200, rawPct)) / 100;

      if (node.gainNode) {
        node.gainNode.gain.value = gainValue;
      } else {
        node.element.muted = isDeafened;
        node.element.volume = Math.min(1, gainValue);
      }
    }

    for (const el of this.screenAudioElements.values()) {
      el.muted = isDeafened;
    }
  }

  private cleanupAllAudioNodes(): void {
    for (const userId of Array.from(this.voiceAudioNodes.keys())) {
      this.detachVoiceAudio(userId);
    }
    for (const id of Array.from(this.screenAudioElements.keys())) {
      this.detachScreenAudio(id);
    }
  }
}

export const livekitService = new LiveKitCallService();
