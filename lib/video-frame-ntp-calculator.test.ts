import { describe, expect, it } from "vitest";
import {
  NTP_UNIX_EPOCH_OFFSET_MS,
  calculateNtpFromCaptureTime,
  calculateNtpFromFrame,
  calculateNtpFromVideoFrameTimestamp,
  formatTimestampMilliseconds,
  parseCalculatorValue,
} from "./video-frame-ntp-calculator";

describe("VideoFrame NTP calculator", () => {
  it("prefers captureTime over VideoFrame.timestamp", () => {
    const result = calculateNtpFromFrame({
      performanceTimeOriginMs: 1_786_326_156_034.635,
      videoFrameTimestampUs: 42,
      metadata: { captureTime: 106_574_320.365 },
    });

    expect(result).toMatchObject({
      method: "capture-time",
      confidence: "preferred",
      captureTimeMs: 106_574_320.365,
      unixTimestampMs: 1_786_432_730_355,
      ntpTimestampMs: 3_995_421_530_355,
    });
  });

  it.each([
    undefined,
    {},
    { captureTime: -1 },
    { captureTime: Number.NaN },
    { captureTime: "106574320.365" },
  ])("falls back for unavailable or invalid captureTime: %o", (metadata) => {
    const result = calculateNtpFromFrame({
      performanceTimeOriginMs: 1_786_326_156_034.635,
      videoFrameTimestampUs: 106_574_320_365,
      metadata,
    });

    expect(result).toMatchObject({
      method: "video-frame-timestamp",
      confidence: "unverified-approximation",
      captureTimeMs: null,
      unixTimestampMs: 1_786_432_730_355,
      ntpTimestampMs: 3_995_421_530_355,
    });
  });

  it("uses milliseconds for captureTime", () => {
    expect(calculateNtpFromCaptureTime(1000.25, 20.5)).toMatchObject({
      unixTimestampMs: 1020.75,
      ntpTimestampMs: NTP_UNIX_EPOCH_OFFSET_MS + 1020.75,
    });
  });

  it("converts VideoFrame timestamp microseconds to milliseconds", () => {
    expect(calculateNtpFromVideoFrameTimestamp(1000.25, 20_500)).toMatchObject({
      unixTimestampMs: 1020.75,
      ntpTimestampMs: NTP_UNIX_EPOCH_OFFSET_MS + 1020.75,
    });
  });

  it.each(["", "-1", "NaN", "Infinity", "not-a-number"])(
    "rejects an invalid manual value: %s",
    (value) => {
      expect(() => parseCalculatorValue(value, "timeOrigin")).toThrow(
        RangeError,
      );
    },
  );

  it("retains useful decimal precision when formatting", () => {
    expect(formatTimestampMilliseconds(3_995_421_530_355.365)).toBe(
      "3995421530355.365",
    );
  });
});
