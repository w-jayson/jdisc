import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractCompanionOwnerId,
  isOwnCompanionParticipant,
  livekitService,
} from "./livekitService";

describe("livekitService self-screenshare companion suppression", () => {
  const localUserId = "a1234567-89ab-cdef-0123-456789abcdef";

  it("blocks subscription when participant identity matches {localUserId}:screenshare", () => {
    expect(
      isOwnCompanionParticipant(
        `${localUserId}:screenshare`,
        undefined,
        localUserId
      )
    ).toBe(true);
  });

  it("blocks subscription when metadata declares isCompanion and parentUserId === localUserId", () => {
    const metadata = JSON.stringify({
      isCompanion: true,
      parentUserId: localUserId,
      preset: "1080p60",
    });
    expect(
      isOwnCompanionParticipant("custom-companion-id", metadata, localUserId)
    ).toBe(true);
  });

  it("allows subscription for another participant's companion identity", () => {
    const otherUserId = "b9999999-89ab-cdef-0123-456789abcdef";
    const metadata = JSON.stringify({
      isCompanion: true,
      parentUserId: otherUserId,
    });
    expect(
      isOwnCompanionParticipant(
        `${otherUserId}:screenshare`,
        metadata,
        localUserId
      )
    ).toBe(false);
  });

  it("extracts the parent userId from a companion identity", () => {
    expect(extractCompanionOwnerId(`${localUserId}:screenshare`)).toBe(
      localUserId
    );
    expect(extractCompanionOwnerId(localUserId)).toBe(localUserId);
  });
});

describe("livekitService voice audio teardown across room switches", () => {
  const originalWindow = globalThis.window;
  const originalMediaStream = globalThis.MediaStream;

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.MediaStream = originalMediaStream;
    vi.restoreAllMocks();
  });

  it("disconnects WebAudio nodes, detaches tracks, and closes AudioContexts on disconnect", async () => {
    class FakeMediaStream {}
    globalThis.MediaStream = FakeMediaStream as unknown as typeof MediaStream;

    const sourceDisconnect = vi.fn();
    const gainDisconnect = vi.fn();
    const closeSpy = vi.fn(async function (this: { state: string }) {
      this.state = "closed";
    });
    const resumeSpy = vi.fn(async function (this: { state: string }) {
      this.state = "running";
    });

    const createdContexts: Array<{ state: string }> = [];

    class FakeAudioContext {
      public state: AudioContextState = "suspended";
      public destination = {};
      public close = closeSpy;
      public resume = resumeSpy;

      constructor() {
        createdContexts.push(this);
      }

      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: sourceDisconnect,
        };
      }

      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: gainDisconnect,
        };
      }
    }

    globalThis.window = {
      AudioContext: FakeAudioContext,
    } as unknown as Window & typeof globalThis;

    const fakeElement = {
      autoplay: false,
      muted: false,
      volume: 1,
      srcObject: new FakeMediaStream(),
      pause: vi.fn(),
      remove: vi.fn(),
    };
    const detachSpy = vi.fn();
    const fakeTrack = {
      attach: vi.fn(() => fakeElement),
      detach: detachSpy,
    };

    const internalService = livekitService as unknown as {
      attachVoiceAudio: (userId: string, track: unknown) => void;
    };

    internalService.attachVoiceAudio("user-remote-1", fakeTrack);
    expect(createdContexts).toHaveLength(1);
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    await livekitService.disconnectFromVoiceRoom({ playLeaveSound: false });

    expect(sourceDisconnect).toHaveBeenCalledTimes(1);
    expect(gainDisconnect).toHaveBeenCalledTimes(1);
    expect(detachSpy).toHaveBeenCalledWith(fakeElement);
    expect(fakeElement.pause).toHaveBeenCalledTimes(1);
    expect(fakeElement.remove).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // Re-attaching in a subsequent room must allocate a fresh AudioContext
    fakeElement.srcObject = new FakeMediaStream();
    internalService.attachVoiceAudio("user-remote-1", fakeTrack);
    expect(createdContexts).toHaveLength(2);

    await livekitService.disconnectFromVoiceRoom({ playLeaveSound: false });
  });

  it("applies selected outputDeviceId via setSinkId on playback AudioContext and switches devices in active room", async () => {
    class FakeMediaStream {}
    globalThis.MediaStream = FakeMediaStream as unknown as typeof MediaStream;

    const setSinkIdSpy = vi.fn(async () => {});
    const closeSpy = vi.fn(async function (this: { state: string }) {
      this.state = "closed";
    });

    class FakeAudioContext {
      public state: AudioContextState = "running";
      public destination = {};
      public close = closeSpy;
      public resume = vi.fn(async () => {});
      public setSinkId = setSinkIdSpy;

      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }

      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
    }

    globalThis.window = {
      AudioContext: FakeAudioContext,
    } as unknown as Window & typeof globalThis;

    const switchActiveDeviceSpy = vi.fn(async () => true);
    const fakeRoom = {
      switchActiveDevice: switchActiveDeviceSpy,
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(async () => {}),
      localParticipant: {
        getTrackPublication: vi.fn(() => undefined),
      },
    };

    const internalService = livekitService as unknown as {
      room: unknown;
      attachVoiceAudio: (userId: string, track: unknown) => void;
    };
    internalService.room = fakeRoom;

    const fakeElement = {
      autoplay: false,
      muted: false,
      volume: 1,
      srcObject: new FakeMediaStream(),
      pause: vi.fn(),
      remove: vi.fn(),
    };
    const fakeTrack = {
      attach: vi.fn(() => fakeElement),
      detach: vi.fn(),
    };

    internalService.attachVoiceAudio("user-remote-1", fakeTrack);

    await livekitService.updateAudioDevices(
      { inputDeviceId: "mic-usb-1", outputDeviceId: "headset-out-2" },
      false
    );

    expect(switchActiveDeviceSpy).toHaveBeenCalledWith(
      "audioinput",
      "mic-usb-1"
    );
    expect(switchActiveDeviceSpy).toHaveBeenCalledWith(
      "audiooutput",
      "headset-out-2"
    );
    expect(setSinkIdSpy).toHaveBeenCalledWith("headset-out-2");

    await livekitService.updateAudioDevices(
      { inputDeviceId: null, outputDeviceId: null },
      false
    );
    expect(setSinkIdSpy).toHaveBeenCalledWith("");

    await livekitService.disconnectFromVoiceRoom({ playLeaveSound: false });
  });
});
