import { describe, expect, it } from "vitest";
import { pickH264Codecs } from "./codecPreference";

const cap = (mimeType: string): RTCRtpCodec => ({
  mimeType,
  clockRate: 90_000,
  channels: 1,
});

describe("pickH264Codecs", () => {
  it("keeps only H264 codec entries", () => {
    const all = [
      cap("video/VP8"),
      cap("video/H264"),
      cap("video/AV1"),
      cap("video/H264"),
      cap("video/rtx"),
      cap("video/red"),
      cap("video/ulpfec"),
    ];
    const filtered = pickH264Codecs(all);
    expect(filtered.length).toBeGreaterThan(0);
    for (const codec of filtered) {
      expect(["video/H264", "video/rtx", "video/red", "video/ulpfec"]).toContain(codec.mimeType);
    }
    // At minimum one H264 entry must be present.
    expect(filtered.some((c) => c.mimeType === "video/H264")).toBe(true);
  });

  it("returns an empty array when there is no H264", () => {
    const filtered = pickH264Codecs([cap("video/VP8"), cap("video/AV1")]);
    expect(filtered).toEqual([]);
  });
});
