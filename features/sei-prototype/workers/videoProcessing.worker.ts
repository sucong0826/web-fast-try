/// <reference lib="webworker" />
import { createMetadataSender } from "@/features/sei-prototype/metadata/metadataChannel";
import { createSamplingState, stepSampling, type SamplingState } from "@/features/sei-prototype/sei/samplingState";

declare const self: DedicatedWorkerGlobalScope;

interface InitMessage {
  type: "init";
  metadataPort: MessagePort;
  readable: ReadableStream<VideoFrame>;
  writable: WritableStream<VideoFrame>;
}

type IncomingMessage = InitMessage | { type: "stop" };

const log = (...args: unknown[]) => console.log("[VPW]", ...args);

let stopped = false;

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  if (event.data.type !== "init") {
    if (event.data.type === "stop") stopped = true;
    return;
  }
  const { metadataPort, readable, writable } = event.data;
  const metadata = createMetadataSender(metadataPort);
  const reader = readable.getReader();
  const writer = writable.getWriter();
  let state: SamplingState = createSamplingState();

  log("started");

  try {
    while (!stopped) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;

      const ts = frame.timestamp;
      const decision = stepSampling(state, ts);
      state = decision.state;

      if (decision.flush) {
        metadata.sendFlush();
        self.postMessage({ src: "vpw", kind: "flush", t: Date.now(), payload: { ts } });
      }

      if (decision.sample) {
        const reassembled = await reassemble(frame, ts);
        metadata.sendMetadata({ vfTimestampUs: ts, batchId: decision.batchId, frameId: decision.frameId });
        self.postMessage({
          src: "vpw",
          kind: "sample",
          t: Date.now(),
          payload: {
            ts,
            batchId: decision.batchId,
            frameId: decision.frameId,
            newTs: reassembled.timestamp,
          },
        });
        try {
          await writer.write(reassembled);
        } catch (err) {
          log("writer.write failed", err);
        }
        frame.close();
      } else {
        self.postMessage({
          src: "vpw",
          kind: "passthrough",
          t: Date.now(),
          payload: { ts },
        });
        await writer.write(frame);
      }
    }
  } catch (err) {
    log("loop error", err);
    self.postMessage({ src: "vpw", kind: "error", t: Date.now(), payload: { message: String(err) } });
  } finally {
    try { await writer.close(); } catch { /* writer may already be closed */ }
    log("stopped");
  }
};

async function reassemble(frame: VideoFrame, ts: number): Promise<VideoFrame> {
  const size = frame.allocationSize();
  const buffer = new ArrayBuffer(size);
  const layout = await frame.copyTo(buffer);
  await new Promise<void>((resolve) => setTimeout(resolve, 10)); // mock 10 ms processing
  const init: VideoFrameBufferInit = {
    format: frame.format as VideoPixelFormat,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    timestamp: ts, // invariant: must equal source ts
    layout,
  };
  return new VideoFrame(buffer, init);
}
