import { SignalingClient } from "@/features/webrtc-meeting/signaling/SignalingClient";
import {
  createClientMessageId,
  createJoinRoomMessage,
  createParticipantId,
  normalizeRoomId,
  type IceCandidateSignalMessage,
  type ParticipantRole,
  type RoomSnapshotMessage,
  type SessionDescriptionSignalMessage,
  type SignalMessage,
} from "@/features/webrtc-meeting/protocol/messages";
import { pickH264Codecs } from "@/features/sei-prototype/pipeline/codecPreference";
import type { EnvSnapshot, RawLogEntry, StatsSnapshot } from "@/features/sei-prototype/metadata/types";

export interface NetworkedSessionOptions {
  signalingUrl: string;
  roomId: string;
  displayName: string;
  onRawLog: (entry: RawLogEntry) => void;
  onRoleAssigned: (role: ParticipantRole) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onSignalingState: (state: "connecting" | "open" | "closed" | "error") => void;
  onError: (error: Error) => void;
}

export interface NetworkedSessionHandles {
  role: ParticipantRole;
  localStream: MediaStream | null;
  envSnapshot: EnvSnapshot;
  captureStats: () => Promise<StatsSnapshot>;
  stop: () => Promise<void>;
}

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

export async function startNetworkedSession(options: NetworkedSessionOptions): Promise<NetworkedSessionHandles> {
  const participantId = createParticipantId();
  const normalizedRoomId = normalizeRoomId(options.roomId);

  let pc: RTCPeerConnection | null = null;
  let role: ParticipantRole | null = null;
  let localStream: MediaStream | null = null;
  const workers: Worker[] = [];
  let metadataChannel: MessageChannel | null = null;
  let lastAnswerSdp = "";

  const signaling = new SignalingClient({
    url: options.signalingUrl,
    onStateChange: options.onSignalingState,
    onError: (msg) => options.onError(new Error(msg)),
    onMessage: (msg) => handleSignal(msg),
  });

  await signaling.connect();
  signaling.join(createJoinRoomMessage({ roomId: normalizedRoomId, participantId, displayName: options.displayName }));

  // Wait for the room snapshot so we know our role before building the PC.
  const snapshot = await waitForSnapshot();
  role = snapshot.self.role;
  options.onRoleAssigned(role);

  const { peerConnection, stream } = role === "caller"
    ? await buildCallerPipeline()
    : await buildAnswererPipeline();
  pc = peerConnection;
  localStream = stream;

  // ICE / track wiring (shared).
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      const message: IceCandidateSignalMessage = {
        type: "ice-candidate",
        roomId: normalizedRoomId,
        participantId,
        messageId: createClientMessageId(),
        sentAt: Date.now(),
        candidate: event.candidate.toJSON(),
      };
      try { signaling.send(message); } catch (err) { options.onError(err instanceof Error ? err : new Error(String(err))); }
    }
  };
  pc.onconnectionstatechange = () => options.onConnectionState(pc!.connectionState);
  pc.ontrack = (event) => {
    const remote = event.streams[0] ?? new MediaStream([event.track]);
    options.onRemoteStream(remote);
  };

  // If caller and peer already in room, drive the offer now. If caller and peer arrives later, wait for peer-joined.
  if (role === "caller" && snapshot.peer) {
    await driveOffer();
  }

  const envSnapshot: EnvSnapshot = {
    ua: navigator.userAgent,
    chromeVersion: chromeMajor(),
    negotiatedCodec: { mimeType: null, profileLevelId: null, packetizationMode: null, levelAsymmetryAllowed: null },
    cameraSettings: localStream?.getVideoTracks()[0]?.getSettings() ?? null,
  };

  const captureStats = async (): Promise<StatsSnapshot> => {
    if (!pc) return { at: Date.now(), pc1: [], pc2: [] };
    const stats = await pc.getStats().then((report) => Array.from(report.values()));
    return role === "caller"
      ? { at: Date.now(), pc1: stats, pc2: [] }
      : { at: Date.now(), pc1: [], pc2: stats };
  };

  const stop = async () => {
    try { signaling.close(); } catch { /* ignore */ }
    try { pc?.close(); } catch { /* ignore */ }
    for (const w of workers) {
      try { w.postMessage({ type: "stop" }); } catch { /* ignore */ }
      try { w.terminate(); } catch { /* ignore */ }
    }
    if (localStream) {
      for (const t of localStream.getTracks()) t.stop();
    }
    try { metadataChannel?.port1.close(); } catch { /* ignore */ }
    try { metadataChannel?.port2.close(); } catch { /* ignore */ }
  };

  return {
    role: role!,
    localStream,
    envSnapshot,
    captureStats,
    stop,
  };

  // ---- inner helpers (closure over state) ----

  function waitForSnapshot(): Promise<RoomSnapshotMessage> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Timed out waiting for room snapshot")), 10_000);
      pendingSnapshotResolvers.push({
        resolve: (msg) => { window.clearTimeout(timer); resolve(msg); },
        reject: (err) => { window.clearTimeout(timer); reject(err); },
      });
    });
  }

  async function buildCallerPipeline(): Promise<{ peerConnection: RTCPeerConnection; stream: MediaStream }> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, frameRate: 30 },
      audio: false,
    });
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("No video track from getUserMedia");

    metadataChannel = new MessageChannel();
    const vpwWorker = new Worker(
      new URL("../workers/videoProcessing.worker.ts", import.meta.url),
      { type: "module" },
    );
    const senderEtwWorker = new Worker(
      new URL("../workers/encodedTransform.worker.ts", import.meta.url),
      { type: "module" },
    );
    workers.push(vpwWorker, senderEtwWorker);
    listenWorker(vpwWorker, options.onRawLog);
    listenWorker(senderEtwWorker, options.onRawLog);

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
    const peerConnection = new RTCPeerConnection();
    const tx = peerConnection.addTransceiver("video", { direction: "sendonly" });
    const caps = RTCRtpSender.getCapabilities("video");
    if (!caps) throw new Error("RTCRtpSender.getCapabilities('video') unavailable");
    const h264Codecs = pickH264Codecs(caps.codecs);
    if (h264Codecs.length === 0) throw new Error("No H264 codec available");
    tx.setCodecPreferences(h264Codecs);
    await tx.sender.replaceTrack(generatorTrack);

    // Force OpenH264 (SW) — see prototype Task 13 commit notes.
    const params = tx.sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0] = {
      ...params.encodings[0],
      active: true,
      maxBitrate: 200_000,
      scaleResolutionDownBy: 4,
    };
    await tx.sender.setParameters(params);

    tx.sender.transform = new RTCRtpScriptTransform(senderEtwWorker, { role: "sender" });
    return { peerConnection, stream };
  }

  async function buildAnswererPipeline(): Promise<{ peerConnection: RTCPeerConnection; stream: MediaStream }> {
    const recvEtwWorker = new Worker(
      new URL("../workers/encodedTransform.worker.ts", import.meta.url),
      { type: "module" },
    );
    workers.push(recvEtwWorker);
    listenWorker(recvEtwWorker, options.onRawLog);

    const peerConnection = new RTCPeerConnection();
    const rx = peerConnection.addTransceiver("video", { direction: "recvonly" });
    rx.receiver.transform = new RTCRtpScriptTransform(recvEtwWorker, { role: "receiver" });
    return { peerConnection, stream: new MediaStream() };
  }

  async function driveOffer(): Promise<void> {
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const message: SessionDescriptionSignalMessage = {
      type: "offer",
      roomId: normalizedRoomId,
      participantId,
      messageId: createClientMessageId(),
      sentAt: Date.now(),
      description: offer,
    };
    signaling.send(message);
  }

  async function handleOffer(message: SessionDescriptionSignalMessage): Promise<void> {
    if (!pc) return;
    await pc.setRemoteDescription(message.description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    lastAnswerSdp = answer.sdp ?? "";
    envSnapshot.negotiatedCodec = extractNegotiatedCodec(lastAnswerSdp);
    const reply: SessionDescriptionSignalMessage = {
      type: "answer",
      roomId: normalizedRoomId,
      participantId,
      messageId: createClientMessageId(),
      sentAt: Date.now(),
      description: answer,
    };
    signaling.send(reply);
  }

  async function handleAnswer(message: SessionDescriptionSignalMessage): Promise<void> {
    if (!pc) return;
    await pc.setRemoteDescription(message.description);
    lastAnswerSdp = message.description.sdp ?? "";
    envSnapshot.negotiatedCodec = extractNegotiatedCodec(lastAnswerSdp);
  }

  async function handleIce(message: IceCandidateSignalMessage): Promise<void> {
    if (!pc) return;
    try { await pc.addIceCandidate(message.candidate); } catch (err) { options.onError(err instanceof Error ? err : new Error(String(err))); }
  }

  function handleSignal(message: SignalMessage): void {
    switch (message.type) {
      case "room-snapshot": {
        const resolver = pendingSnapshotResolvers.shift();
        resolver?.resolve(message);
        break;
      }
      case "peer-joined": {
        if (role === "caller") void driveOffer();
        break;
      }
      case "offer": {
        void handleOffer(message);
        break;
      }
      case "answer": {
        void handleAnswer(message);
        break;
      }
      case "ice-candidate": {
        void handleIce(message);
        break;
      }
      default:
        break;
    }
  }
}

const pendingSnapshotResolvers: Array<{
  resolve: (msg: RoomSnapshotMessage) => void;
  reject: (err: Error) => void;
}> = [];
