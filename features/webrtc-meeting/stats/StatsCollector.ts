import type { MeetingStatsSnapshot } from "../types";

export function normalizeStatsReport(
  report: RTCStatsReport,
  previous: { bytesSent: number; timestamp: number } | null
): MeetingStatsSnapshot {
  let bytesSent = 0;
  let packetsLost = 0;
  let roundTripTimeMs = 0;
  let framesPerSecond = 0;
  let width = 0;
  let height = 0;
  let timestamp = Date.now();
  let candidatePair = "";

  report.forEach((stat) => {
    if (stat.type === "outbound-rtp" && (stat as any).kind === "video") {
      bytesSent = (stat as any).bytesSent || bytesSent;
      packetsLost = (stat as any).packetsLost || packetsLost;
      framesPerSecond = (stat as any).framesPerSecond || framesPerSecond;
      width = (stat as any).frameWidth || width;
      height = (stat as any).frameHeight || height;
      timestamp = (stat as any).timestamp || timestamp;
    }

    if (stat.type === "candidate-pair" && (stat as any).state === "succeeded") {
      const rttSeconds = (stat as any).currentRoundTripTime || 0;
      roundTripTimeMs = Math.round(rttSeconds * 1000);
      candidatePair = `${(stat as any).localCandidateId || "local"} -> ${(stat as any).remoteCandidateId || "remote"}`;
    }
  });

  const bitrateKbps =
    previous && timestamp > previous.timestamp
      ? Math.round(((bytesSent - previous.bytesSent) * 8) / (timestamp - previous.timestamp))
      : 0;

  return {
    bitrateKbps,
    packetsLost,
    roundTripTimeMs,
    framesPerSecond,
    width,
    height,
    candidatePair,
  };
}

function readOutboundVideoCounter(report: RTCStatsReport): { bytesSent: number; timestamp: number } {
  let counter = { bytesSent: 0, timestamp: Date.now() };
  report.forEach((stat) => {
    if (stat.type === "outbound-rtp" && (stat as any).kind === "video") {
      counter = {
        bytesSent: (stat as any).bytesSent || 0,
        timestamp: (stat as any).timestamp || Date.now(),
      };
    }
  });
  return counter;
}

export class StatsCollector {
  private intervalId: number | null = null;
  private previous: { bytesSent: number; timestamp: number } | null = null;

  constructor(
    private readonly peerConnection: RTCPeerConnection,
    private readonly onStats: (stats: MeetingStatsSnapshot) => void
  ) {}

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = window.setInterval(async () => {
      const report = await this.peerConnection.getStats();
      const stats = normalizeStatsReport(report, this.previous);
      this.previous = readOutboundVideoCounter(report);
      this.onStats(stats);
    }, 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.previous = null;
  }
}
