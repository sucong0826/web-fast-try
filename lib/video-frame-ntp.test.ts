import { describe, expect, it } from "vitest";
import {
  calculateFrameTimestampStrategies,
  formatNtpEpochMilliseconds,
  normalizeServerNtpTimestamp,
  ntpEpochUsToQ32_32,
  parseNtpEpochMilliseconds,
  q32_32ToNtpEpochUs,
} from "./video-frame-ntp";

describe("NTP timestamp representations", () => {
  it("parses NTP epoch milliseconds into exact integer microseconds", () => {
    expect(parseNtpEpochMilliseconds("3995421530355")).toBe(
      3995421530355000n,
    );
    expect(parseNtpEpochMilliseconds("3995421530355.365")).toBe(
      3995421530355365n,
    );
  });

  it("formats NTP epoch microseconds without losing the sub-millisecond part", () => {
    expect(formatNtpEpochMilliseconds(3995421530355000n)).toBe(
      "3995421530355",
    );
    expect(formatNtpEpochMilliseconds(3995421530355365n)).toBe(
      "3995421530355.365",
    );
  });

  it("round-trips the sample through standard NTP Q32.32", () => {
    const q32 = ntpEpochUsToQ32_32(3995421530355000n);

    expect(q32).toBe("17160204806608996270");
    expect(q32_32ToNtpEpochUs(q32)).toBe(3995421530355000n);
  });

  it("normalizes only the explicitly selected server format", () => {
    expect(normalizeServerNtpTimestamp("3995421530355", "epoch-ms")).toBe(
      3995421530355000n,
    );
    expect(
      normalizeServerNtpTimestamp("17160204806608996270", "q32.32"),
    ).toBe(3995421530355000n);
  });

  it.each(["", "-1", "12.1234", "not-a-time"])(
    "rejects malformed NTP epoch milliseconds: %s",
    (value) => {
      expect(() => parseNtpEpochMilliseconds(value)).toThrow(RangeError);
    },
  );
});

describe("VideoFrame timestamp strategies", () => {
  const baseInput = {
    frameTimestampUs: 106574320365,
    observedUnixEpochUs: 1786432730355000,
    performanceTimeOriginMs: 1786326156034.635,
    performanceNowMs: 106574320.365,
    clientAnchor: {
      frameTimestampUs: 106574320365,
      unixEpochUs: 1786432730355000,
    },
    serverAnchor: {
      frameTimestampUs: 106574320365,
      ntpEpochUs: 3995421530355000n,
    },
  };

  it("calculates all four mappings from the hand-checked sample", () => {
    const strategies = calculateFrameTimestampStrategies(baseInput);

    expect(strategies.naiveUnixEpochUs).toBe(106574320365n);
    expect(strategies.timeOriginUnixEpochUs).toBe(1786432730355000n);
    expect(strategies.clientAnchorUnixEpochUs).toBe(1786432730355000n);
    expect(strategies.manualServerNtpEpochUs).toBe(3995421530355000n);
    expect(strategies.performanceDeltaMs).toBe(0);
    expect(strategies.timeOriginPlausible).toBe(true);
  });

  it("marks a time-origin mapping unverified when the clocks are far apart", () => {
    const strategies = calculateFrameTimestampStrategies({
      ...baseInput,
      performanceNowMs: 1,
    });

    expect(strategies.timeOriginPlausible).toBe(false);
  });

  it("advances manual NTP time by the VideoFrame timestamp delta", () => {
    const strategies = calculateFrameTimestampStrategies({
      ...baseInput,
      frameTimestampUs: 106574353698,
    });

    expect(strategies.manualServerNtpEpochUs).toBe(3995421530388333n);
  });

  it("omits manual mapping until a server anchor is supplied", () => {
    const strategies = calculateFrameTimestampStrategies({
      ...baseInput,
      serverAnchor: null,
    });

    expect(strategies.manualServerNtpEpochUs).toBeNull();
  });
});
