/// <reference lib="webworker" />
import { createMetadataReceiver } from "@/features/sei-prototype/metadata/metadataChannel";
import { injectSei, parseSei } from "@/features/sei-prototype/sei/h264SeiCodec";
import type { MetadataChannelMessage } from "@/features/sei-prototype/metadata/types";

declare const self: DedicatedWorkerGlobalScope;

const log = (prefix: string, ...args: unknown[]) => console.log(prefix, ...args);

interface CachedMeta {
  batchId: number;
  frameId: number;
  recordedAtMs: number;
}

interface SenderState {
  cache: Map<number, CachedMeta>;
  loggedFirstFrame: boolean;
}

// Single sender-side cache shared across the lifetime of this worker.
// Only populated when role === "sender" via the metadata port; for
// receiver-role workers this map stays empty and is never consulted.
const senderState: SenderState = { cache: new Map(), loggedFirstFrame: false };

self.onmessage = (event: MessageEvent<{ type: "init-metadata-port"; port: MessagePort }>) => {
  if (event.data?.type !== "init-metadata-port") return;
  const receiver = createMetadataReceiver(event.data.port);
  receiver.onMessage((msg: MetadataChannelMessage) => {
    if (msg.kind === "flush") {
      senderState.cache.clear();
      return;
    }
    senderState.cache.set(msg.vfTimestampUs, {
      batchId: msg.batchId,
      frameId: msg.frameId,
      recordedAtMs: Date.now(),
    });
  });
};

// Install the transformer handler unconditionally at module top so both
// sender and receiver worker instances respond to RTCRtpScriptTransform
// without waiting for a role-specific init message.
self.onrtctransform = (event) => {
  const transformer = event.transformer;
  const role = transformer.options.role;
  const prefix = role === "sender" ? "[Sender ETW]" : "[Recv ETW]";

  const transform = new TransformStream<RTCEncodedVideoFrame, RTCEncodedVideoFrame>({
    transform(frame, controller) {
      if (role === "sender") {
        handleSenderFrame(prefix, frame, senderState);
      } else {
        handleReceiverFrame(prefix, frame);
      }
      controller.enqueue(frame);
    },
  });

  transformer.readable.pipeThrough(transform).pipeTo(transformer.writable).catch((err) => {
    log(prefix, "pipeline error", err);
  });
  log(prefix, "transformer attached", { role });
};

function handleSenderFrame(prefix: string, frame: RTCEncodedVideoFrame, state: SenderState) {
  const meta = frame.getMetadata();
  const lookupKey = Number(meta.timestamp ?? frame.timestamp);
  if (!state.loggedFirstFrame) {
    state.loggedFirstFrame = true;
    self.postMessage({
      src: "sender-etw",
      kind: "first-frame-hex",
      t: Date.now(),
      payload: { hex: hexDump(frame.data, 64), encodedTs: frame.timestamp, metaTs: meta.timestamp },
    });
  }

  const cached = state.cache.get(lookupKey);
  if (!cached) {
    const nearest = findNearestKey(state.cache, lookupKey);
    self.postMessage({
      src: "sender-etw",
      kind: "miss",
      t: Date.now(),
      payload: {
        encodedTs: frame.timestamp,
        metaTs: meta.timestamp,
        metaRtpTs: meta.rtpTimestamp,
        metaFrameId: meta.frameId,
        lookupKey,
        nearestKey: nearest.key,
        nearestDeltaUs: nearest.deltaUs,
      },
    });
    return;
  }

  try {
    const injected = injectSei(frame.data, {
      batchId: cached.batchId,
      frameId: cached.frameId,
      vfTimestampUs: lookupKey,
    });
    frame.data = injected;
    const selfParse = parseSei(frame.data);
    self.postMessage({
      src: "sender-etw",
      kind: "hit",
      t: Date.now(),
      payload: {
        encodedTs: frame.timestamp,
        metaTs: meta.timestamp,
        metaRtpTs: meta.rtpTimestamp,
        metaFrameId: meta.frameId,
        lookupKey,
        cached,
        selfParse,
      },
    });
  } catch (err) {
    self.postMessage({
      src: "sender-etw",
      kind: "inject-error",
      t: Date.now(),
      payload: { message: String(err), encodedTs: frame.timestamp, lookupKey },
    });
  }
}

function handleReceiverFrame(_prefix: string, frame: RTCEncodedVideoFrame) {
  const meta = frame.getMetadata();
  let parsed: ReturnType<typeof parseSei> = null;
  try {
    parsed = parseSei(frame.data);
  } catch {
    parsed = null;
  }
  self.postMessage({
    src: "recv-etw",
    kind: parsed ? "recv-hit" : "recv-miss",
    t: Date.now(),
    payload: {
      encodedTs: frame.timestamp,
      metaTs: meta.timestamp,
      metaRtpTs: meta.rtpTimestamp,
      metaFrameId: meta.frameId,
      parsed,
    },
  });
}

function findNearestKey(cache: Map<number, CachedMeta>, lookupKey: number): { key: number | null; deltaUs: number | null } {
  let bestKey: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const key of cache.keys()) {
    const delta = Math.abs(key - lookupKey);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestKey = key;
    }
  }
  return bestKey === null ? { key: null, deltaUs: null } : { key: bestKey, deltaUs: bestDelta };
}

function hexDump(data: ArrayBuffer, n: number): string {
  const view = new Uint8Array(data, 0, Math.min(n, data.byteLength));
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join(" ");
}
