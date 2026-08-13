import { describe, expect, it } from "vitest";
import {
  FrameClockAnchor,
  NTP_UNIX_EPOCH_OFFSET_MS,
  calculateNtpFromCaptureTime,
  calculateNtpFromFrame,
  calculateNtpFromTimestampAnchor,
  convertEpochMilliseconds,
  convertNtpQ32_32ToUnix,
  formatLocalTimestamp,
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

  it("uses a recent-window minimum offset to anchor VideoFrame.timestamp", () => {
    const anchor = new FrameClockAnchor();
    const first = anchor.observe(2_505_600_000_000, 1_786_524_400_010);
    const second = anchor.observe(2_505_600_033_333, 1_786_524_400_060);

    expect(first).toMatchObject({
      anchorOffsetMs: 1_784_018_800_010,
      sampleCount: 1,
      observedDelayMs: 0,
      wasReset: false,
    });
    expect(second).toMatchObject({
      anchorOffsetMs: 1_784_018_800_010,
      sampleCount: 2,
      observedDelayMs: 16.6669921875,
      wasReset: false,
    });
  });

  it("resets the anchor when a timestamp jumps forward by more than five seconds", () => {
    const anchor = new FrameClockAnchor();
    anchor.observe(1_000_000, 5_000);

    expect(anchor.observe(7_000_001, 11_000)).toMatchObject({
      sampleCount: 1,
      wasReset: true,
    });
  });

  it("resets the anchor when a timestamp goes backwards but not when it repeats", () => {
    const anchor = new FrameClockAnchor();
    anchor.observe(2_000_000, 6_000);

    expect(anchor.observe(2_000_000, 6_010).wasReset).toBe(false);
    expect(anchor.observe(1_999_999, 6_020)).toMatchObject({
      sampleCount: 1,
      wasReset: true,
    });
  });

  it("keeps only the most recent 64 anchor samples", () => {
    const anchor = new FrameClockAnchor();
    for (let index = 0; index < 65; index += 1) {
      anchor.observe(index * 1_000, 10_000 + index);
    }

    expect(anchor.observe(65_000, 10_065)).toMatchObject({
      anchorOffsetMs: 10_000,
      sampleCount: 64,
    });
  });

  it("uses captureTime only with the preferred strategy", () => {
    const anchor = new FrameClockAnchor();
    const anchorObservation = anchor.observe(
      106_574_320_365,
      1_786_432_730_355,
    );
    const input = {
      performanceTimeOriginMs: 1_786_326_156_034.635,
      videoFrameTimestampUs: 106_574_320_365,
      metadata: { captureTime: 106_574_320.365 },
      anchorObservation,
    };

    expect(
      calculateNtpFromFrame({
        ...input,
        strategy: "prefer-capture-time",
      }).method,
    ).toBe("capture-time");
    expect(
      calculateNtpFromFrame({ ...input, strategy: "timestamp-anchor" }),
    ).toMatchObject({
      method: "timestamp-anchor",
      confidence: "local-clock-anchor",
      unixTimestampMs: 1_786_432_730_355,
      ntpTimestampMs: 3_995_421_530_355,
      captureTimeMs: 106_574_320.365,
      anchorSampleCount: 1,
    });
  });

  it.each([
    undefined,
    {},
    { captureTime: -1 },
    { captureTime: Number.NaN },
    { captureTime: "106574320.365" },
  ])("anchors unavailable or invalid captureTime: %o", (metadata) => {
    const anchor = new FrameClockAnchor();
    const result = calculateNtpFromFrame({
      performanceTimeOriginMs: 1_786_326_156_034.635,
      videoFrameTimestampUs: 106_574_320_365,
      metadata,
      anchorObservation: anchor.observe(
        106_574_320_365,
        1_786_432_730_355,
      ),
    });

    expect(result).toMatchObject({
      method: "timestamp-anchor",
      confidence: "local-clock-anchor",
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

  it("calculates NTP time from a VideoFrame timestamp and clock anchor", () => {
    expect(calculateNtpFromTimestampAnchor(20_500, 1000.25, 3, 2.5)).toMatchObject({
      method: "timestamp-anchor",
      confidence: "local-clock-anchor",
      unixTimestampMs: 1020.75,
      ntpTimestampMs: NTP_UNIX_EPOCH_OFFSET_MS + 1020.75,
      anchorSampleCount: 3,
      observedDelayMs: 2.5,
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

  it("formats a Unix timestamp in a supplied browser time zone with milliseconds", () => {
    const result = formatLocalTimestamp(1_786_525_630_036, {
      locales: "en-GB",
      timeZone: "Asia/Shanghai",
    });

    expect(result.timeZone).toBe("Asia/Shanghai");
    expect(result.display).toMatch(/17:07:10\.036/);
  });
});

describe("Unix/NTP epoch converter", () => {
  it("adds the epoch offset without losing fractional millisecond digits", () => {
    expect(
      convertEpochMilliseconds("1786432730355.365", "unix-to-ntp"),
    ).toMatchObject({
      direction: "unix-to-ntp",
      sourceTimestampMs: "1786432730355.365",
      convertedTimestampMs: "3995421530355.365",
      unixTimestampMs: "1786432730355.365",
      utcTimestamp: "2026-08-11T07:18:50.355Z",
      expression:
        "1786432730355.365 + 2208988800000 = 3995421530355.365",
    });
  });

  it("subtracts the epoch offset without floating-point noise", () => {
    expect(
      convertEpochMilliseconds("3995421530355.365", "ntp-to-unix"),
    ).toMatchObject({
      direction: "ntp-to-unix",
      sourceTimestampMs: "3995421530355.365",
      convertedTimestampMs: "1786432730355.365",
      unixTimestampMs: "1786432730355.365",
      expression:
        "3995421530355.365 - 2208988800000 = 1786432730355.365",
    });
  });

  it("preserves trailing fractional zeros", () => {
    expect(
      convertEpochMilliseconds("1.2300", "unix-to-ntp")
        .convertedTimestampMs,
    ).toBe("2208988800001.2300");
  });

  it.each(["", "-1", ".5", "NaN", "Infinity", "not-a-time"])(
    "rejects a malformed epoch value: %s",
    (value) => {
      expect(() =>
        convertEpochMilliseconds(value, "unix-to-ntp"),
      ).toThrow(RangeError);
    },
  );

  it("rejects an NTP value before the supported Unix epoch", () => {
    expect(() =>
      convertEpochMilliseconds("2208988799999.999", "ntp-to-unix"),
    ).toThrow("before the supported Unix epoch");
  });

  it("accepts the exact maximum JavaScript Date boundary", () => {
    expect(
      convertEpochMilliseconds("8640000000000000.000", "unix-to-ntp")
        .unixTimestampMs,
    ).toBe("8640000000000000.000");
  });

  it.each([
    ["8640000000000000.1", "unix-to-ntp"],
    ["8642208988800000.1", "ntp-to-unix"],
  ] as const)(
    "rejects an exact decimal beyond the JavaScript Date boundary: %s",
    (value, direction) => {
      expect(() => convertEpochMilliseconds(value, direction)).toThrow(
        "outside the supported UTC date range",
      );
    },
  );
});

describe("NTP Q32.32 converter", () => {
  it("converts the supplied packed Q32.32 decimal value without precision loss", () => {
    expect(convertNtpQ32_32ToUnix("17160596469120441998")).toMatchObject({
      sourceQ32_32: "17160596469120441998",
      ntpSeconds: "3995512721",
      ntpFraction: "1673469582",
      unixTimestampSeconds: "1786523921.389634999912",
      unixTimestampMilliseconds: "1786523921389.634999912232",
      unixMillisecondsForDate: "1786523921389",
      utcTimestamp: "2026-08-12T08:38:41.389Z",
    });
  });

  it("accepts the exact Unix epoch boundary", () => {
    expect(convertNtpQ32_32ToUnix("9487534653230284800")).toMatchObject({
      ntpSeconds: "2208988800",
      ntpFraction: "0",
      unixTimestampSeconds: "0.000000000000",
      unixTimestampMilliseconds: "0.000000000000",
      utcTimestamp: "1970-01-01T00:00:00.000Z",
    });
  });

  it("accepts the maximum unsigned Q32.32 value in Era 0", () => {
    expect(convertNtpQ32_32ToUnix("18446744073709551615")).toMatchObject({
      ntpSeconds: "4294967295",
      ntpFraction: "4294967295",
    });
  });

  it.each([
    "",
    "-1",
    "+1",
    "1.5",
    "NaN",
    "18446744073709551616",
  ])("rejects invalid Q32.32 input: %s", (value) => {
    expect(() => convertNtpQ32_32ToUnix(value)).toThrow(RangeError);
  });

  it("rejects an Era 0 Q32.32 value before Unix epoch", () => {
    expect(() => convertNtpQ32_32ToUnix("0")).toThrow(
      "before the supported Unix epoch",
    );
  });
});
