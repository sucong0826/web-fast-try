import { describe, expect, it } from "vitest";
import { normalizeStatsReport } from "./StatsCollector";

describe("normalizeStatsReport", () => {
  it("normalizes outbound RTP and candidate pair stats", () => {
    const report = new Map<string, any>([
      ["outbound-video", {
        type: "outbound-rtp",
        kind: "video",
        bytesSent: 120000,
        packetsLost: 2,
        framesPerSecond: 30,
        frameWidth: 1280,
        frameHeight: 720,
      }],
      ["candidate", {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.023,
        localCandidateId: "local",
        remoteCandidateId: "remote",
      }],
    ]);

    const stats = normalizeStatsReport(report as unknown as RTCStatsReport, null);

    expect(stats.packetsLost).toBe(2);
    expect(stats.roundTripTimeMs).toBe(23);
    expect(stats.framesPerSecond).toBe(30);
    expect(stats.width).toBe(1280);
    expect(stats.height).toBe(720);
  });
});
