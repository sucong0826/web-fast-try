import type {
  EnvSnapshot,
  ExportPayload,
  PassFailVerdict,
  RawLogEntry,
  SampleRow,
  SeiPayload,
  StatsSnapshot,
} from "@/features/sei-prototype/metadata/types";

const MAX_RAW_LOG = 5000;

export interface Summary {
  framesOut: number;
  sampled: number;
  injected: number;
  hits: number;
  recvParsed: number;
  passFail: PassFailVerdict;
  framesDecoded: number;
  freezeCount: number;
}

export interface AggregatorState {
  rows: Map<number, SampleRow>;
  rawLog: RawLogEntry[];
  framesOut: number;
  sampled: number;
  injected: number;
  hits: number;
  recvParsed: number;
  framesDecoded: number;
  freezeCount: number;
  startedAtMs: number;
  stoppedAtMs: number;
  envSnapshot: EnvSnapshot | null;
  statsSnapshots: StatsSnapshot[];
}

export interface AggregatorOptions {
  onUpdate?: (state: AggregatorState) => void;
}

function ensureRow(state: AggregatorState, vfTimestampUs: number, batchId: number, frameId: number, vpwAtMs: number): SampleRow {
  let row = state.rows.get(vfTimestampUs);
  if (!row) {
    row = { vfTimestampUs, batchId, frameId, vpwAtMs };
    state.rows.set(vfTimestampUs, row);
  }
  return row;
}

export function createAggregator(options: AggregatorOptions = {}) {
  const state: AggregatorState = {
    rows: new Map(),
    rawLog: [],
    framesOut: 0,
    sampled: 0,
    injected: 0,
    hits: 0,
    recvParsed: 0,
    framesDecoded: 0,
    freezeCount: 0,
    startedAtMs: 0,
    stoppedAtMs: 0,
    envSnapshot: null,
    statsSnapshots: [],
  };

  function logRaw(entry: RawLogEntry) {
    state.rawLog.push(entry);
    if (state.rawLog.length > MAX_RAW_LOG) state.rawLog.shift();
  }

  function ingestVpw(entry: RawLogEntry) {
    if (entry.kind === "sample" || entry.kind === "passthrough") {
      state.framesOut += 1;
    }
    if (entry.kind === "sample") {
      state.sampled += 1;
      const ts = entry.payload.ts as number;
      const row = ensureRow(state, ts, entry.payload.batchId as number, entry.payload.frameId as number, entry.t);
      row.newVfTimestampUs = entry.payload.newTs as number;
    }
    logRaw(entry);
  }

  function ingestSenderEtw(entry: RawLogEntry) {
    if (entry.kind === "first-frame-hex" || entry.kind === "inject-error") {
      logRaw(entry);
      return;
    }
    const lookupKey = entry.payload.lookupKey as number;
    const row = state.rows.get(lookupKey);
    if (row) {
      row.senderHitAtMs = entry.t;
      row.senderEncodedTs = entry.payload.encodedTs as number;
      row.senderMetaTimestamp = entry.payload.metaTs as number | undefined;
      row.senderMetaRtpTs = entry.payload.metaRtpTs as number | undefined;
      row.senderMetaFrameId = entry.payload.metaFrameId as number | undefined;
      if (entry.kind === "hit") {
        row.senderHit = true;
        row.senderSelfParse = entry.payload.selfParse as SeiPayload | null;
        state.hits += 1;
        if (row.senderSelfParse !== null) state.injected += 1;
      } else {
        row.senderHit = false;
        row.senderSelfParse = null;
      }
    }
    logRaw(entry);
  }

  function ingestRecvEtw(entry: RawLogEntry) {
    const parsed = entry.payload.parsed as SeiPayload | null | undefined;
    const metaTs = entry.payload.metaTs as number | undefined;
    // Prefer the parsed payload's vfTimestampUs as the join key so that
    // a deviation between RTCEncodedVideoFrameMetadata.timestamp and the
    // VPW-side vfTimestampUs (i.e., an H1 failure) does NOT block H4
    // from being evaluated. Fall back to metaTs only when parsed is null.
    const joinKey = parsed?.vfTimestampUs ?? metaTs;
    if (joinKey !== undefined) {
      const row = state.rows.get(joinKey);
      if (row) {
        row.recvAtMs = entry.t;
        row.recvEncodedTs = entry.payload.encodedTs as number | undefined;
        row.recvMetaTimestamp = metaTs;
        row.recvMetaRtpTs = entry.payload.metaRtpTs as number | undefined;
        row.recvSEI = parsed ?? null;
        if (row.recvSEI) state.recvParsed += 1;
      }
    }
    logRaw(entry);
  }

  function notify() {
    options.onUpdate?.(state);
  }

  return {
    state,
    setEnvSnapshot(env: EnvSnapshot) { state.envSnapshot = env; notify(); },
    addStatsSnapshot(snap: StatsSnapshot) { state.statsSnapshots.push(snap); notify(); },
    markStart() { state.startedAtMs = Date.now(); notify(); },
    markStop() { state.stoppedAtMs = Date.now(); notify(); },
    updateDecodeStats({ framesDecoded, freezeCount }: { framesDecoded: number; freezeCount: number }) {
      state.framesDecoded = framesDecoded;
      state.freezeCount = freezeCount;
      notify();
    },
    ingest(entry: RawLogEntry) {
      switch (entry.src) {
        case "vpw": ingestVpw(entry); break;
        case "sender-etw": ingestSenderEtw(entry); break;
        case "recv-etw": ingestRecvEtw(entry); break;
      }
      notify();
    },
    getSummary(): Summary {
      return {
        framesOut: state.framesOut,
        sampled: state.sampled,
        injected: state.injected,
        hits: state.hits,
        recvParsed: state.recvParsed,
        framesDecoded: state.framesDecoded,
        freezeCount: state.freezeCount,
        passFail: computeVerdict(state),
      };
    },
    buildExport(): ExportPayload {
      return {
        env: state.envSnapshot ?? blankEnv(),
        startedAtMs: state.startedAtMs,
        stoppedAtMs: state.stoppedAtMs,
        summary: {
          framesOut: state.framesOut,
          sampled: state.sampled,
          injected: state.injected,
          hits: state.hits,
          recvParsed: state.recvParsed,
          passFail: computeVerdict(state),
        },
        samples: Array.from(state.rows.values()).sort((a, b) => a.vfTimestampUs - b.vfTimestampUs),
        rawLog: state.rawLog.slice(),
        statsSnapshots: state.statsSnapshots.slice(),
      };
    },
  };
}

function blankEnv(): EnvSnapshot {
  return {
    ua: "",
    chromeVersion: null,
    negotiatedCodec: {
      mimeType: null,
      profileLevelId: null,
      packetizationMode: null,
      levelAsymmetryAllowed: null,
    },
    cameraSettings: null,
  };
}

function computeVerdict(state: AggregatorState): PassFailVerdict {
  const rows = Array.from(state.rows.values());
  const samplesWithSender = rows.filter((r) => r.senderMetaTimestamp !== undefined);
  const h1 = samplesWithSender.length === 0
    ? "pending"
    : samplesWithSender.every((r) => r.senderMetaTimestamp === r.vfTimestampUs)
      ? "pass"
      : "fail";

  const injectedRows = rows.filter((r) => r.senderHit === true);
  const h2 = injectedRows.length === 0
    ? "pending"
    : injectedRows.every((r) =>
        r.senderSelfParse !== null &&
        r.senderSelfParse !== undefined &&
        r.senderSelfParse.vfTimestampUs === r.vfTimestampUs &&
        r.senderSelfParse.batchId === r.batchId &&
        r.senderSelfParse.frameId === r.frameId,
      )
      ? "pass" : "fail";

  const h3 = state.framesDecoded === 0
    ? "pending"
    : state.freezeCount > 0
      ? "fail"
      : (Date.now() - state.startedAtMs >= 30_000 ? "pass" : "pending");

  const recvCandidates = rows.filter((r) => r.senderHit === true);
  const h4 = recvCandidates.length === 0
    ? "pending"
    : recvCandidates.every((r) =>
        r.recvSEI !== null && r.recvSEI !== undefined &&
        r.recvSEI.vfTimestampUs === r.vfTimestampUs &&
        r.recvSEI.batchId === r.batchId &&
        r.recvSEI.frameId === r.frameId,
      )
      ? "pass" : "fail";

  return { H1: h1, H2: h2, H3: h3, H4: h4 };
}
