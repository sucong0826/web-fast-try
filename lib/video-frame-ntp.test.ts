import { describe, expect, it } from "vitest";
import {
  buildNtpComparisonCsv,
  calculateFrameTimestampStrategies,
  createClientFrameAnchor,
  createServerFrameAnchor,
  findNearestNtpEpochUs,
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

  it("keeps the first client anchor for later epoch-like or fallback rows", () => {
    const first = createClientFrameAnchor(null, 1786432730355000, 1786432730360000);
    const second = createClientFrameAnchor(
      first,
      1786432730388333,
      1786432730395000,
    );

    expect(second).toEqual(first);
  });

  it.each([
    ["", "3995421530355"],
    ["not-a-frame", "3995421530355"],
    ["106574320365", "4294967296000"],
  ])(
    "rejects an invalid manual server anchor (%s, %s)",
    (frameTimestamp, serverTimestamp) => {
      expect(() =>
        createServerFrameAnchor(frameTimestamp, serverTimestamp, "epoch-ms"),
      ).toThrow(RangeError);
    },
  );

  it("returns no manual mapping when the media delta underflows NTP era zero", () => {
    const strategies = calculateFrameTimestampStrategies({
      ...baseInput,
      frameTimestampUs: 1,
      serverAnchor: {
        frameTimestampUs: 106574320365,
        ntpEpochUs: 0n,
      },
    });

    expect(strategies.manualServerNtpEpochUs).toBeNull();
  });
});

describe("server comparison and export", () => {
  it("compares exact microseconds before applying millisecond tolerance", () => {
    expect(
      findNearestNtpEpochUs([3995421530375490n], 3995421530355000n, 20),
    ).toEqual({
      index: 0,
      serverNtpEpochUs: 3995421530375490n,
      diffUs: 20490n,
      diffMs: 20.49,
      matched: false,
    });
  });

  it("exports every clock anchor and normalized matched server value", () => {
    const strategies = calculateFrameTimestampStrategies({
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
    });

    const csv = buildNtpComparisonCsv({
      rows: [
        {
          id: 7,
          source: "native frame",
          frameTimestampUs: 106574320365,
          observedUnixEpochUs: 1786432730355000,
          performanceTimeOriginMs: 1786326156034.635,
          performanceNowMs: 106574320.365,
          clientAnchor: {
            frameTimestampUs: 106574320365,
            unixEpochUs: 1786432730355000,
          },
          strategies,
        },
      ],
      serverFormat: "epoch-ms",
      serverAnchor: {
        frameTimestampUs: 106574320365,
        ntpEpochUs: 3995421530355000n,
      },
      toleranceMs: 20,
      serverTimestamps: [3995421530355000n],
    });

    expect(csv).toContain("client_anchor_frame_timestamp_us");
    expect(csv).toContain("manual_reference_ntp_epoch_us");
    expect(csv).toContain("manual-anchor_matched_server_ntp_epoch_us");
    expect(csv).toContain(
      "106574320365,1786432730355000,106574320365,3995421530355000,epoch-ms,20",
    );
  });
});
