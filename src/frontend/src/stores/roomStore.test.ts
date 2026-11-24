import { beforeEach, describe, expect, it } from "vitest";
import { LOCAL_PREVIEW_STREAM_KEY, useRoomStore } from "./roomStore";

describe("roomStore local screenshare preview state", () => {
  beforeEach(() => {
    useRoomStore.setState({
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
    });
  });

  it("auto-selects local preview when starting a stream without remote streams and clears on stop", () => {
    const store = useRoomStore.getState();

    store.setLocalStreamState({
      status: "starting",
      preset: "1080p60",
      audioMode: "process_tree",
    });

    expect(useRoomStore.getState().selectedStreamKey).toBe(
      LOCAL_PREVIEW_STREAM_KEY
    );
    expect(useRoomStore.getState().localStreamPreviewEnabled).toBe(true);

    store.setLocalStreamState({
      status: "streaming",
      sourceTitle: "Counter-Strike 2",
    });
    store.setLocalStreamPreviewUrl("data:image/png;base64,AAAA");

    expect(useRoomStore.getState().localStreamSourceTitle).toBe(
      "Counter-Strike 2"
    );
    expect(useRoomStore.getState().localStreamPreviewUrl).toBe(
      "data:image/png;base64,AAAA"
    );

    store.setLocalStreamState({ status: "idle", warning: null });

    expect(useRoomStore.getState().selectedStreamKey).toBeNull();
    expect(useRoomStore.getState().localStreamSourceTitle).toBeNull();
    expect(useRoomStore.getState().localStreamPreviewUrl).toBeNull();
  });

  it("keeps local preview selected when remote streams update while viewing own preview", () => {
    const store = useRoomStore.getState();

    store.setLocalStreamState({ status: "starting" });
    store.setLocalStreamState({ status: "streaming" });
    expect(useRoomStore.getState().selectedStreamKey).toBe(
      LOCAL_PREVIEW_STREAM_KEY
    );

    store.setRemoteStreams([
      {
        streamKey: "u2:screenshare",
        ownerUserId: "u2",
        ownerDisplayName: "Bob",
        companionIdentity: "u2:screenshare",
        hasAudio: true,
        videoTrack: {},
        audioTrack: {},
      },
    ]);

    expect(useRoomStore.getState().selectedStreamKey).toBe(
      LOCAL_PREVIEW_STREAM_KEY
    );

    // Stopping local stream falls back to the remaining remote stream
    store.setLocalStreamState({ status: "idle" });
    expect(useRoomStore.getState().selectedStreamKey).toBe("u2:screenshare");
  });

  it("updates localStreamAspectMode via stream state and live setter", () => {
    const store = useRoomStore.getState();

    store.setLocalStreamState({
      status: "starting",
      aspectMode: "stretch_16_9",
    });
    expect(useRoomStore.getState().localStreamAspectMode).toBe("stretch_16_9");

    store.setLocalStreamAspectMode("crop_4_3_stretch_16_9");
    expect(useRoomStore.getState().localStreamAspectMode).toBe(
      "crop_4_3_stretch_16_9"
    );
  });
});
