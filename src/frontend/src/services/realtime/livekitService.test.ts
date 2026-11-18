import { describe, expect, it } from "vitest";
import {
  extractCompanionOwnerId,
  isOwnCompanionParticipant,
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
