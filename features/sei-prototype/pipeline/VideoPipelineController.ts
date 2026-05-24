import type {
  EnvSnapshot,
  RawLogEntry,
  StatsSnapshot,
} from "@/features/sei-prototype/metadata/types";
import { pickH264Codecs } from "./codecPreference";

export interface PipelineHandles {
  localStream: MediaStream;
  remoteStream: MediaStream | null;
  pc1: RTCPeerConnection;
  pc2: RTCPeerConnection;
  stop: () => Promise<void>;
  captureStats: () => Promise<StatsSnapshot>;
  envSnapshot: EnvSnapshot;
}

export interface StartPipelineOptions {
  onRawLog: (entry: RawLogEntry) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onError: (error: Error) => void;
}

const VPW_URL = new URL("../workers/videoProcessing.worker.ts", import.meta.url);
const ETW_URL = new URL("../workers/encodedTransform.worker.ts", import.meta.url);

function chromeMajor(): string | null {
  const m = navigator.userAgent.match(/Chrome\/(\d+)/);
  return m ? m[1] : null;
}

function listenWorker(worker: Worker, onRawLog: (entry: RawLogEntry) => void) {
  worker.onmessage = (event: MessageEvent<RawLogEntry>) => {
    const entry = event.data;
    if (entry && typeof entry === "object" && "src" in entry && "kind" in entry) {
      onRawLog(entry);
    }
  };
}

export async function startPipeline(options: StartPipelineOptions): Promise<PipelineHandles> {
  const errors: Error[] = [];
  const report = (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    errors.push(e);
    options.onError(e);
  };

  const localStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
    audio: false,
  });
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error("No video track available from getUserMedia");

  // Channel ① — VPW <-> Sender ETW.
  const metadataChannel = new MessageChannel();

  const vpwWorker = new Worker(VPW_URL, { type: "module" });
  const senderEtwWorker = new Worker(ETW_URL, { type: "module" });
  const recvEtwWorker = new Worker(ETW_URL, { type: "module" });

  listenWorker(vpwWorker, options.onRawLog);
  listenWorker(senderEtwWorker, options.onRawLog);
  listenWorker(recvEtwWorker, options.onRawLog);

  senderEtwWorker.postMessage({ type: "init-metadata-port", port: metadataChannel.port2 }, [metadataChannel.port2]);

  const processor = new MediaStreamTrackProcessor({ track: videoTrack });
  const generator = new MediaStreamTrackGenerator({ kind: "video" });

  vpwWorker.postMessage({
    type: "init",
    metadataPort: metadataChannel.port1,
    readable: processor.readable,
    writable: generator.writable,
  }, [metadataChannel.port1, processor.readable, generator.writable]);

  const generatorTrack = generator as unknown as MediaStreamTrack;

  // pc1: sender.
  const pc1 = new RTCPeerConnection();
  const tx = pc1.addTransceiver("video", { direction: "sendrecv" });
  const caps = RTCRtpSender.getCapabilities("video");
  if (!caps) throw new Error("RTCRtpSender.getCapabilities('video') unavailable");
  const h264Codecs = pickH264Codecs(caps.codecs);
  if (h264Codecs.length === 0) throw new Error("No H264 codec available — refusing to start prototype");
  tx.setCodecPreferences(h264Codecs);
  await tx.sender.replaceTrack(generatorTrack);
  tx.sender.transform = new RTCRtpScriptTransform(senderEtwWorker, { role: "sender" });

  // pc2: receiver.
  const pc2 = new RTCPeerConnection();
  const rx = pc2.addTransceiver("video", { direction: "recvonly" });
  rx.receiver.transform = new RTCRtpScriptTransform(recvEtwWorker, { role: "receiver" });

  let remoteStream: MediaStream | null = null;
  pc2.ontrack = (event) => {
    remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    options.onRemoteStream(remoteStream);
  };

  pc1.onicecandidate = (event) => {
    if (event.candidate) void pc2.addIceCandidate(event.candidate).catch(report);
  };
  pc2.onicecandidate = (event) => {
    if (event.candidate) void pc1.addIceCandidate(event.candidate).catch(report);
  };
  pc1.onconnectionstatechange = () => options.onConnectionState(pc1.connectionState);

  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);

  const envSnapshot: EnvSnapshot = {
    ua: navigator.userAgent,
    chromeVersion: chromeMajor(),
    negotiatedCodec: extractNegotiatedCodec(answer.sdp ?? ""),
    cameraSettings: videoTrack.getSettings(),
  };

  const captureStats = async (): Promise<StatsSnapshot> => {
    const [pc1Stats, pc2Stats] = await Promise.all([
      pc1.getStats().then((report) => Array.from(report.values())),
      pc2.getStats().then((report) => Array.from(report.values())),
    ]);
    return { at: Date.now(), pc1: pc1Stats, pc2: pc2Stats };
  };

  const stop = async () => {
    try { vpwWorker.postMessage({ type: "stop" }); } catch { /* ignore */ }
    try { pc1.close(); } catch { /* ignore */ }
    try { pc2.close(); } catch { /* ignore */ }
    try { vpwWorker.terminate(); } catch { /* ignore */ }
    try { senderEtwWorker.terminate(); } catch { /* ignore */ }
    try { recvEtwWorker.terminate(); } catch { /* ignore */ }
    for (const track of localStream.getTracks()) track.stop();
  };

  return {
    localStream,
    remoteStream,
    pc1,
    pc2,
    stop,
    captureStats,
    envSnapshot,
  };
}

function extractNegotiatedCodec(sdp: string): EnvSnapshot["negotiatedCodec"] {
  const lines = sdp.split(/\r?\n/);
  const h264Line = lines.find((l) => /^a=rtpmap:\d+ H264\//i.test(l));
  if (!h264Line) {
    return { mimeType: null, profileLevelId: null, packetizationMode: null, levelAsymmetryAllowed: null };
  }
  const m = h264Line.match(/^a=rtpmap:(\d+) /);
  const pt = m ? m[1] : null;
  const fmtp = pt ? lines.find((l) => l.startsWith(`a=fmtp:${pt} `)) : undefined;
  const params: Record<string, string> = {};
  if (fmtp) {
    const body = fmtp.replace(/^a=fmtp:\d+ /, "");
    for (const kv of body.split(";")) {
      const [k, v] = kv.split("=").map((s) => s.trim());
      if (k) params[k] = v ?? "";
    }
  }
  return {
    mimeType: "video/H264",
    profileLevelId: params["profile-level-id"] ?? null,
    packetizationMode: params["packetization-mode"] ?? null,
    levelAsymmetryAllowed: params["level-asymmetry-allowed"] ?? null,
  };
}
