// Fixed 16-byte UUID used as the user_data_unregistered identifier for
// our SEI payload. Generated once via crypto.randomUUID() and committed
// as a literal byte array so the receiver can reliably distinguish our
// SEIs from any other user_data_unregistered SEIs in the stream.
//
// UUID: 7f9c3a8e-1b2d-4e5f-9a6b-0c1d2e3f4a5b
export const SEI_UUID_BYTES: ReadonlyArray<number> = [
  0x7f, 0x9c, 0x3a, 0x8e,
  0x1b, 0x2d, 0x4e, 0x5f,
  0x9a, 0x6b, 0x0c, 0x1d,
  0x2e, 0x3f, 0x4a, 0x5b,
];

export const SEI_PAYLOAD_BYTES = 32; // UUID(16) + batchId(4) + frameId(4) + vfTimestampUs(8)

export interface FrameMetadata {
  kind: "metadata";
  vfTimestampUs: number;
  batchId: number;
  frameId: number;
}

export interface FlushSignal {
  kind: "flush";
}

export type MetadataChannelMessage = FrameMetadata | FlushSignal;

export interface SeiPayload {
  batchId: number;
  frameId: number;
  vfTimestampUs: number;
}

export interface SampleRow {
  vfTimestampUs: number;
  newVfTimestampUs?: number;
  batchId: number;
  frameId: number;
  vpwAtMs: number;

  senderHitAtMs?: number;
  senderEncodedTs?: number;
  senderMetaTimestamp?: number;
  senderMetaRtpTs?: number;
  senderMetaFrameId?: number;
  senderHit?: boolean;
  senderSelfParse?: SeiPayload | null;

  recvAtMs?: number;
  recvEncodedTs?: number;
  recvMetaTimestamp?: number;
  recvMetaRtpTs?: number;
  recvSEI?: SeiPayload | null;
}

export type RawLogSource = "vpw" | "sender-etw" | "recv-etw";

export interface RawLogEntry {
  t: number;          // ms since epoch (main-thread receive time)
  src: RawLogSource;
  kind: string;
  payload: Record<string, unknown>;
}

export interface PassFailVerdict {
  H1: "pass" | "fail" | "pending";
  H2: "pass" | "fail" | "pending";
  H3: "pass" | "fail" | "pending";
  H4: "pass" | "fail" | "pending";
}

export interface EnvSnapshot {
  ua: string;
  chromeVersion: string | null;
  negotiatedCodec: {
    mimeType: string | null;
    profileLevelId: string | null;
    packetizationMode: string | null;
    levelAsymmetryAllowed: string | null;
  };
  cameraSettings: MediaTrackSettings | null;
}

export interface StatsSnapshot {
  at: number;
  pc1: unknown;
  pc2: unknown;
}

export interface ExportPayload {
  env: EnvSnapshot;
  startedAtMs: number;
  stoppedAtMs: number;
  summary: {
    framesOut: number;
    sampled: number;
    injected: number;
    hits: number;
    recvParsed: number;
    passFail: PassFailVerdict;
  };
  samples: SampleRow[];
  rawLog: RawLogEntry[];
  statsSnapshots: StatsSnapshot[];
}
