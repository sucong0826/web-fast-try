// Minimal ambient declarations for Web APIs not covered by TypeScript's
// default lib.dom in this project. Scoped to the SEI prototype so global
// lib.dom remains untouched.

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: MediaStreamTrackProcessorInit);
  readonly readable: ReadableStream<T>;
}

interface MediaStreamTrackGeneratorInit {
  kind: "audio" | "video";
}

declare class MediaStreamTrackGenerator<T = VideoFrame> extends MediaStreamTrack {
  constructor(init: MediaStreamTrackGeneratorInit);
  readonly writable: WritableStream<T>;
}

interface RTCEncodedVideoFrameMetadata {
  frameId?: number;
  dependencies?: number[];
  width?: number;
  height?: number;
  spatialIndex?: number;
  temporalIndex?: number;
  synchronizationSource?: number;
  payloadType?: number;
  contributingSources?: number[];
  timestamp?: number;
  rtpTimestamp?: number;
}

interface RTCEncodedVideoFrame {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  data: ArrayBuffer;
  getMetadata(): RTCEncodedVideoFrameMetadata;
}

interface RTCRtpScriptTransformerOptions {
  role: "sender" | "receiver";
}

declare class RTCRtpScriptTransform {
  constructor(worker: Worker, options?: RTCRtpScriptTransformerOptions);
}

interface RTCRtpSender {
  transform?: RTCRtpScriptTransform | null;
}

interface RTCRtpReceiver {
  transform?: RTCRtpScriptTransform | null;
}

interface RTCRtpScriptTransformer {
  readonly readable: ReadableStream<RTCEncodedVideoFrame>;
  readonly writable: WritableStream<RTCEncodedVideoFrame>;
  readonly options: RTCRtpScriptTransformerOptions;
}

interface RTCTransformEvent extends Event {
  readonly transformer: RTCRtpScriptTransformer;
}

interface DedicatedWorkerGlobalScope {
  onrtctransform: ((event: RTCTransformEvent) => void) | null;
}
