import {
  ConnectionState,
  LocalAudioTrack,
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
  setSoundEffectsOutputDevice,
} from "../../utils/soundEffects";
import { stopScreenStream } from "../desktop/captureService";
import { saveAppSettings } from "../desktop/settingsService";
import type {
  AudioDeviceConfig,
  NoiseReductionConfig,
} from "../desktop/types";
import {
  type MicLevelSample,
  NoiseGateProcessor,
} from "./noiseReductionProcessor";
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
  track: RemoteTrack;
  element: HTMLAudioElement;
  sourceNode: MediaStreamAudioSourceNode | null;
  gainNode: GainNode | null;
}

interface RemoteScreenAudioNode {
  track: RemoteTrack;
  element: HTMLAudioElement;
}

type SinkCapableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

class LiveKitCallService {
  private room: Room | null = null;
  private playbackAudioContext: AudioContext | null = null;
  private captureAudioContext: AudioContext | null = null;
  private voiceAudioNodes = new Map<string, RemoteVoiceAudioNode>();
  private screenAudioElements = new Map<string, RemoteScreenAudioNode>();
  private noiseProcessor: NoiseGateProcessor | null = null;
  private noiseProcessorTrack: LocalAudioTrack | null = null;
  private noiseProcessorUnsub: (() => void) | null = null;
  private micLevelListeners = new Set<(sample: MicLevelSample) => void>();
  private lastAppliedWebrtcNs: boolean | null = null;
  private noiseSyncQueue: Promise<void> = Promise.resolve();
  private connectionEpoch = 0;

  public async connectToVoiceRoom(
    roomId: string,
    roomName: string,
    livekitUrl: string,
    voiceToken: string
  ): Promise<void> {
    const currentStore = useRoomStore.getState();
    if (
      this.room &&
      currentStore.activeRoomId === roomId &&
      this.room.state === ConnectionState.Connected
    ) {
      return;
    }

    const epoch = ++this.connectionEpoch;

    if (this.room) {
      await this.disconnectFromVoiceRoom({ playLeaveSound: false });
      if (epoch !== this.connectionEpoch) {
        return;
      }
    }

    const roomStore = useRoomStore.getState();
    roomStore.setCallConnectionState("connecting");
    roomStore.setActiveCall(roomId, roomName, livekitUrl);

    const { noiseReduction, audioDevices } =
      useDesktopSettingsStore.getState().settings;
    const effectiveWebrtcNs =
      noiseReduction.enabled && noiseReduction.webrtcNoiseSuppression;
    setSoundEffectsOutputDevice(audioDevices.outputDeviceId);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        deviceId: audioDevices.inputDeviceId ?? undefined,
        noiseSuppression: effectiveWebrtcNs,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
    this.room = room;
    this.lastAppliedWebrtcNs = effectiveWebrtcNs;

    this.registerRoomListeners(room, roomId, epoch);

    try {
      await room.connect(livekitUrl, voiceToken, {
        autoSubscribe: true,
      });

      if (epoch !== this.connectionEpoch || this.room !== room) {
        room.removeAllListeners();
        await room.disconnect(true).catch(() => {});
        return;
      }

      if (audioDevices.outputDeviceId) {
        await room
          .switchActiveDevice("audiooutput", audioDevices.outputDeviceId)
          .catch(() => {});
      }

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (micErr) {
        if (audioDevices.inputDeviceId) {
          // Saved device may have been unplugged; fall back to system default
          await room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: "default",
            noiseSuppression: effectiveWebrtcNs,
            echoCancellation: true,
            autoGainControl: true,
          });
        } else {
          throw micErr;
        }
      }

      if (epoch !== this.connectionEpoch || this.room !== room) {
        room.removeAllListeners();
        await room.disconnect(true).catch(() => {});
        return;
      }

      await this.syncNoiseReductionToLocalTrack();

      if (epoch !== this.connectionEpoch || this.room !== room) {
        room.removeAllListeners();
        await room.disconnect(true).catch(() => {});
        return;
      }

      roomStore.setLocalAudioFlags(false, false);
      roomStore.setCallConnectionState("connected");
      playJoinRoomSound();

      // Enforce self-screenshare suppression on any existing participants in the room
      this.enforceSelfCompanionBlockOnAll(room);
      this.rebuildRemoteStreamsList(room);
    } catch (err) {
      if (this.room === room) {
        await this.disconnectFromVoiceRoom({ playLeaveSound: false });
      } else {
        room.removeAllListeners();
        await room.disconnect(true).catch(() => {});
      }
      throw err;
    }
  }

  public async disconnectFromVoiceRoom(options?: {
    playLeaveSound?: boolean;
  }): Promise<void> {
    const playLeaveSound = options?.playLeaveSound ?? true;
    const roomStore = useRoomStore.getState();
    if (roomStore.localStreamStatus !== "idle") {
      await stopScreenStream();
      roomStore.setLocalStreamState({ status: "idle", warning: null });
    }

    const roomToDisconnect = this.room;
    this.room = null;
    this.lastAppliedWebrtcNs = null;

    if (roomToDisconnect) {
      roomToDisconnect.removeAllListeners();

      const micPub = roomToDisconnect.localParticipant.getTrackPublication(
        Track.Source.Microphone
      );
      const localAudioTrack = micPub?.track;
      this.clearNoiseProcessorRefs();

      if (localAudioTrack instanceof LocalAudioTrack) {
        try {
          await localAudioTrack.stopProcessor();
        } catch {
          // Ignore if no processor is attached or track is already stopped
        }
      }

      await this.noiseSyncQueue;

      try {
        await roomToDisconnect.disconnect(true);
      } catch {
        // Ignore disconnect errors
      }
    } else {
      this.clearNoiseProcessorRefs();
      await this.noiseSyncQueue;
    }

    this.cleanupAllAudioNodes();
    await this.closeAudioContexts();

    roomStore.setRemoteStreams([]);
    roomStore.setActiveSpeakerIds([]);
    roomStore.setActiveCall(null, null, null);
    roomStore.setCallConnectionState("disconnected");
    if (playLeaveSound) {
      playLeaveRoomSound();
    }
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

  public async updateNoiseReduction(
    config: NoiseReductionConfig,
    persist = true
  ): Promise<void> {
    const store = useDesktopSettingsStore.getState();
    store.setNoiseReduction(config);
    const normalized = useDesktopSettingsStore.getState().settings.noiseReduction;

    if (
      normalized.enabled &&
      this.noiseProcessor &&
      this.noiseProcessorTrack &&
      this.lastAppliedWebrtcNs === normalized.webrtcNoiseSuppression
    ) {
      this.noiseProcessor.updateConfig(normalized);
    } else {
      await this.syncNoiseReductionToLocalTrack();
    }

    if (persist) {
      await saveAppSettings(useDesktopSettingsStore.getState().settings);
    }
  }

  public async toggleNoiseReduction(): Promise<void> {
    const current = useDesktopSettingsStore.getState().settings.noiseReduction;
    await this.updateNoiseReduction({
      ...current,
      enabled: !current.enabled,
    });
  }

  public async updateAudioDevices(
    config: AudioDeviceConfig,
    persist = true
  ): Promise<void> {
    const store = useDesktopSettingsStore.getState();
    const previous = store.settings.audioDevices;
    store.setAudioDevices(config);
    const normalized = useDesktopSettingsStore.getState().settings.audioDevices;

    setSoundEffectsOutputDevice(normalized.outputDeviceId);

    if (this.room) {
      if (previous.inputDeviceId !== normalized.inputDeviceId) {
        try {
          await this.room.switchActiveDevice(
            "audioinput",
            normalized.inputDeviceId ?? "default"
          );
        } catch {
          if (normalized.inputDeviceId) {
            await this.room
              .switchActiveDevice("audioinput", "default")
              .catch(() => {});
          }
        }
        await this.syncNoiseReductionToLocalTrack();
      }

      if (previous.outputDeviceId !== normalized.outputDeviceId) {
        await this.room
          .switchActiveDevice(
            "audiooutput",
            normalized.outputDeviceId ?? "default"
          )
          .catch(() => {});
        await this.applyOutputDeviceToAllTargets(normalized.outputDeviceId);
      }
    }

    if (persist) {
      await saveAppSettings(useDesktopSettingsStore.getState().settings);
    }
  }

  public isNoiseProcessorActive(): boolean {
    return Boolean(this.noiseProcessor && this.noiseProcessorTrack);
  }

  public subscribeLocalMicLevel(
    listener: (sample: MicLevelSample) => void
  ): () => void {
    this.micLevelListeners.add(listener);
    return () => {
      this.micLevelListeners.delete(listener);
    };
  }

  public syncNoiseReductionToLocalTrack(): Promise<void> {
    this.noiseSyncQueue = this.noiseSyncQueue
      .then(() => this.performNoiseReductionSync())
      .catch(() => {});
    return this.noiseSyncQueue;
  }

  private async performNoiseReductionSync(): Promise<void> {
    if (!this.room) {
      this.clearNoiseProcessorRefs();
      return;
    }

    const micPub = this.room.localParticipant.getTrackPublication(
      Track.Source.Microphone
    );
    const localAudioTrack = micPub?.track;
    if (!(localAudioTrack instanceof LocalAudioTrack)) {
      this.clearNoiseProcessorRefs();
      return;
    }

    const config = useDesktopSettingsStore.getState().settings.noiseReduction;
    const effectiveWebrtcNs =
      config.enabled && config.webrtcNoiseSuppression;

    if (this.lastAppliedWebrtcNs !== effectiveWebrtcNs) {
      try {
        await localAudioTrack.applyConstraints({
          noiseSuppression: effectiveWebrtcNs,
          echoCancellation: true,
          autoGainControl: true,
        });
      } catch {
        // Ignore constraint errors on devices/webviews that reject dynamic changes
      }
      this.lastAppliedWebrtcNs = effectiveWebrtcNs;
    }

    if (config.enabled) {
      if (
        this.noiseProcessor &&
        this.noiseProcessorTrack === localAudioTrack
      ) {
        this.noiseProcessor.updateConfig(config);
        return;
      }

      if (
        (!this.captureAudioContext ||
          this.captureAudioContext.state === "closed") &&
        window.AudioContext
      ) {
        this.captureAudioContext = new window.AudioContext({
          latencyHint: "interactive",
        });
      }
      if (this.captureAudioContext) {
        if (this.captureAudioContext.state === "suspended") {
          await this.captureAudioContext.resume().catch(() => {});
        }
        const currentTrackCtx = (
          localAudioTrack as unknown as { audioContext?: AudioContext }
        ).audioContext;
        if (currentTrackCtx !== this.captureAudioContext) {
          await localAudioTrack.setAudioContext(this.captureAudioContext);
        }
      }

      this.clearNoiseProcessorRefs();
      const processor = new NoiseGateProcessor(config);
      this.noiseProcessor = processor;
      this.noiseProcessorTrack = localAudioTrack;
      this.noiseProcessorUnsub = processor.subscribeLevel((sample) => {
        for (const listener of this.micLevelListeners) {
          listener(sample);
        }
      });

      await localAudioTrack.setProcessor(processor);
    } else {
      if (this.noiseProcessor || this.noiseProcessorTrack) {
        this.clearNoiseProcessorRefs();
        try {
          await localAudioTrack.stopProcessor();
        } catch {
          // Ignore if track was already stopped
        }
      }
    }
  }

  private clearNoiseProcessorRefs(): void {
    this.noiseProcessorUnsub?.();
    this.noiseProcessorUnsub = null;
    this.noiseProcessor = null;
    this.noiseProcessorTrack = null;
  }

  private registerRoomListeners(
    room: Room,
    _roomId: string,
    epoch: number
  ): void {
    const isStale = () =>
      this.room !== room || epoch !== this.connectionEpoch;

    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (isStale()) return;
      if (publication.source === Track.Source.Microphone) {
        void this.syncNoiseReductionToLocalTrack();
      }
    });
    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      if (isStale()) return;
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
      if (isStale()) return;
      const ids = speakers.map((s) => extractCompanionOwnerId(s.identity));
      useRoomStore.getState().setActiveSpeakerIds(ids);
    });

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (isStale()) return;
      this.guardParticipantPublications(participant);
      this.rebuildRemoteStreamsList(room);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (isStale()) return;
      this.detachVoiceAudio(participant.identity);
      this.detachScreenAudio(participant.identity);
      this.rebuildRemoteStreamsList(room);
    });

    room.on(
      RoomEvent.TrackPublished,
      (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (isStale()) return;
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
        if (isStale()) return;
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
        if (isStale()) return;
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
      if (isStale()) return;
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
    const outputDeviceId =
      useDesktopSettingsStore.getState().settings.audioDevices.outputDeviceId;

    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let gainNode: GainNode | null = null;
    try {
      const AudioCtx = window.AudioContext;
      if (AudioCtx && element.srcObject instanceof MediaStream) {
        const createdNewContext =
          !this.playbackAudioContext ||
          this.playbackAudioContext.state === "closed";
        if (createdNewContext) {
          this.playbackAudioContext = new AudioCtx({
            latencyHint: "interactive",
          });
          if (outputDeviceId) {
            void this.applyOutputDeviceToAudioContext(
              this.playbackAudioContext,
              outputDeviceId
            );
          }
        }
        if (
          this.playbackAudioContext &&
          this.playbackAudioContext.state === "suspended"
        ) {
          void this.playbackAudioContext.resume().catch(() => {});
        }
        if (this.playbackAudioContext) {
          sourceNode = this.playbackAudioContext.createMediaStreamSource(
            element.srcObject
          );
          gainNode = this.playbackAudioContext.createGain();
          sourceNode.connect(gainNode);
          gainNode.connect(this.playbackAudioContext.destination);
          element.muted = true; // Output via WebAudio GainNode to support 0-200% boost
        }
      }
    } catch {
      sourceNode?.disconnect();
      gainNode?.disconnect();
      sourceNode = null;
      gainNode = null;
    }

    if (!gainNode && outputDeviceId) {
      void this.applyOutputDeviceToElement(element, outputDeviceId);
    }

    this.voiceAudioNodes.set(userId, { track, element, sourceNode, gainNode });
    this.applyDeafenAndVolumes();
  }

  private detachVoiceAudio(userId: string): void {
    const existing = this.voiceAudioNodes.get(userId);
    if (existing) {
      try {
        existing.sourceNode?.disconnect();
      } catch {
        // Ignore disconnect errors on already-disconnected nodes
      }
      try {
        existing.gainNode?.disconnect();
      } catch {
        // Ignore disconnect errors on already-disconnected nodes
      }
      try {
        existing.track.detach(existing.element);
      } catch {
        // Ignore detach errors if track is already disposed
      }
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
    const outputDeviceId =
      useDesktopSettingsStore.getState().settings.audioDevices.outputDeviceId;
    if (outputDeviceId) {
      void this.applyOutputDeviceToElement(element, outputDeviceId);
    }
    this.screenAudioElements.set(companionIdentity, { track, element });
    this.applyDeafenAndVolumes();
  }

  private detachScreenAudio(companionIdentity: string): void {
    const existing = this.screenAudioElements.get(companionIdentity);
    if (existing) {
      try {
        existing.track.detach(existing.element);
      } catch {
        // Ignore detach errors if track is already disposed
      }
      existing.element.pause();
      existing.element.srcObject = null;
      existing.element.remove();
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

    for (const node of this.screenAudioElements.values()) {
      node.element.muted = isDeafened;
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

  private async applyOutputDeviceToAudioContext(
    ctx: AudioContext,
    outputDeviceId: string | null
  ): Promise<void> {
    const sinkCtx = ctx as SinkCapableAudioContext;
    if (typeof sinkCtx.setSinkId !== "function") {
      return;
    }
    try {
      await sinkCtx.setSinkId(outputDeviceId ?? "");
    } catch {
      if (outputDeviceId) {
        await sinkCtx.setSinkId("").catch(() => {});
      }
    }
  }

  private async applyOutputDeviceToElement(
    element: HTMLAudioElement,
    outputDeviceId: string | null
  ): Promise<void> {
    const sinkEl = element as SinkCapableAudioElement;
    if (typeof sinkEl.setSinkId !== "function") {
      return;
    }
    try {
      await sinkEl.setSinkId(outputDeviceId ?? "");
    } catch {
      if (outputDeviceId) {
        await sinkEl.setSinkId("").catch(() => {});
      }
    }
  }

  private async applyOutputDeviceToAllTargets(
    outputDeviceId: string | null
  ): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (
      this.playbackAudioContext &&
      this.playbackAudioContext.state !== "closed"
    ) {
      tasks.push(
        this.applyOutputDeviceToAudioContext(
          this.playbackAudioContext,
          outputDeviceId
        )
      );
    }

    for (const node of this.voiceAudioNodes.values()) {
      if (!node.gainNode) {
        tasks.push(
          this.applyOutputDeviceToElement(node.element, outputDeviceId)
        );
      }
    }

    for (const node of this.screenAudioElements.values()) {
      tasks.push(this.applyOutputDeviceToElement(node.element, outputDeviceId));
    }

    await Promise.all(tasks);
  }

  private async closeAudioContexts(): Promise<void> {
    const contexts = [this.captureAudioContext, this.playbackAudioContext];
    this.captureAudioContext = null;
    this.playbackAudioContext = null;

    await Promise.all(
      contexts.map(async (ctx) => {
        if (ctx && ctx.state !== "closed") {
          try {
            await ctx.close();
          } catch {
            // Ignore close errors
          }
        }
      })
    );
  }
}

export const livekitService = new LiveKitCallService();
