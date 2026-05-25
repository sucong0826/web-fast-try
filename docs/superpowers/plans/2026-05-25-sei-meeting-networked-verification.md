# SEI Networked Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify whether `RTCRtpScriptTransform` actually intercepts H.264 frames when pc1 and pc2 are in **separate tabs** connected via the real signaling server, ruling out Chrome's suspected same-realm bypass that made the single-tab prototype useless on macOS.

**Architecture:** Add a new route `/test/sei-meeting` that reuses the existing `features/webrtc-meeting/signaling/SignalingClient` and `protocol/messages` to talk to the `server/webrtc-signaling/server.mjs` already in the repo. The page asks the user for a room ID, joins via WebSocket, and the signaling server assigns `caller` or `answerer` role on a first-come basis. Caller spawns the full sender pipeline (camera → VPW → MediaStreamTrackGenerator → pc.sender + SEI Sender ETW). Answerer spawns a receiver-only PC with SEI Receiver ETW. All SEI codec / sampling state / aggregator code lives under `features/sei-prototype/` and is reused verbatim — the only new code is the role-aware networked session controller and a thin UI.

**Tech Stack:** Next.js 14 client component, existing WebSocket signaling server (port 8787), reused `SignalingClient` + `SignalMessage` from webrtc-meeting, reused SEI workers + codec + aggregator from sei-prototype.

---

## Scope Check

This is **not** a multi-subsystem project. It is one feature: a networked verification harness for the existing SEI prototype. One plan is correct.

The plan does NOT cover:
- Refactoring `features/webrtc-meeting/` itself. The meeting feature stays untouched; we only `import` its `SignalingClient` and protocol types.
- Adding new signaling protocol messages. The existing `offer` / `answer` / `ice-candidate` / `join-room` / `room-snapshot` / `peer-joined` / `peer-left` are sufficient.
- WebCodecs refactor (that is "Path B" in the conversation, a separate future plan if this one's verification fails).

---

## File Structure

- Modify `config/testPages.ts`: append a `sei-meeting` entry pointing at `/test/sei-meeting`, icon `Users`, category `Debug`.
- Create `app/test/sei-meeting/page.tsx`: `"use client"` route entry with dynamic import + `ssr: false`, same wrapper styling as `/test/sei-prototype`.
- Create `features/sei-prototype/networked/SeiMeetingApp.tsx`: top-level component. Holds join form state, instantiates `NetworkedSession`, renders the existing summary / sample-table widgets (reuse logic from `SeiPrototypeApp.tsx`).
- Create `features/sei-prototype/networked/NetworkedSession.ts`: role-aware session controller. Joins the signaling room, waits for role assignment, then runs either the caller (sender) or answerer (receiver) pipeline. Reuses `pickH264Codecs`, both worker files, the metadata channel wrapper, and the aggregator.

Existing files reused without modification:
- `features/webrtc-meeting/signaling/SignalingClient.ts`
- `features/webrtc-meeting/protocol/messages.ts`
- `features/sei-prototype/sei/h264SeiCodec.ts`
- `features/sei-prototype/sei/samplingState.ts`
- `features/sei-prototype/pipeline/codecPreference.ts`
- `features/sei-prototype/workers/videoProcessing.worker.ts`
- `features/sei-prototype/workers/encodedTransform.worker.ts`
- `features/sei-prototype/metadata/metadataChannel.ts`
- `features/sei-prototype/metadata/types.ts`
- `features/sei-prototype/logging/tsObservation.ts`
- `server/webrtc-signaling/server.mjs`

---

## Conventions Used Throughout The Plan

- All commits use `feat(sei-meeting): ...` or `chore(sei-meeting): ...` scope.
- TypeScript strict, Vitest for any new pure-function tests (this plan adds none — the controller is integration-tested via the manual two-tab verification at the end).
- Worker URLs use `new URL("...", import.meta.url)` **inline** inside `new Worker(...)` so webpack picks them up (lesson from prototype Task 13 debugging).
- Signaling URL default: `ws://${window.location.hostname}:8787` (matches webrtc-meeting's `JoinScreen.tsx` default).
- Signaling server must be running before opening the page. The dev workflow is `npm run signaling:webrtc` in one terminal and `npm run dev` in another (or `npm run dev:webrtc` which runs both).
- Pre-existing tsc errors in `features/webrtc-meeting/peer/PeerConnectionEngine.test.ts` are out of scope; treat tsc as "clean" if only those three errors remain.

---

## Task 1: Scaffold The Route And UI Placeholder

**Files:**
- Modify: `config/testPages.ts`
- Create: `app/test/sei-meeting/page.tsx`
- Create: `features/sei-prototype/networked/SeiMeetingApp.tsx`

- [ ] **Step 1: Append the test-pages registration entry**

Open `config/testPages.ts` and append the following object inside the `testPages` array, immediately after the `sei-prototype` entry (created in the previous plan):

```ts
,
  {
    id: "sei-meeting",
    title: "SEI Meeting",
    description: "Two-tab networked SEI verification via signaling server",
    icon: "Users",
    path: "/test/sei-meeting",
    category: "Debug"
  }
```

The `Users` icon is already imported in `app/page.tsx` so no icon-map edit is needed.

- [ ] **Step 2: Create the route page**

Create `app/test/sei-meeting/page.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";

const SeiMeetingApp = dynamic(
  () => import("@/features/sei-prototype/networked/SeiMeetingApp"),
  { ssr: false }
);

export default function SeiMeetingPage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-2xl border border-[#ede9f8] dark:border-white/[0.06] bg-white dark:bg-[#0e0e12]">
      <SeiMeetingApp />
    </div>
  );
}
```

- [ ] **Step 3: Create the placeholder SeiMeetingApp**

Create `features/sei-prototype/networked/SeiMeetingApp.tsx`:

```tsx
"use client";

export default function SeiMeetingApp() {
  return (
    <div className="p-6 text-sm text-[#0f0e1a] dark:text-[#f1f0f6]">
      <h1 className="text-xl font-semibold mb-2">SEI Networked Verification</h1>
      <p className="opacity-70">Scaffold loaded. Join UI and pipeline arrive in later tasks.</p>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: only the 3 pre-existing `PeerConnectionEngine.test.ts` errors remain.

- [ ] **Step 5: Commit**

```bash
git add config/testPages.ts app/test/sei-meeting/page.tsx features/sei-prototype/networked/SeiMeetingApp.tsx
git commit -m "feat(sei-meeting): scaffold route and placeholder UI"
```

---

## Task 2: Networked Session Controller

**Files:**
- Create: `features/sei-prototype/networked/NetworkedSession.ts`

This file is one logical unit: it owns the signaling client, the peer connection, the workers (only when needed for the role), and exposes a `start` / `stop` API plus raw-log forwarding into the aggregator.

- [ ] **Step 1: Author the controller**

Create `features/sei-prototype/networked/NetworkedSession.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: only the 3 pre-existing `PeerConnectionEngine.test.ts` errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/networked/NetworkedSession.ts
git commit -m "feat(sei-meeting): role-aware networked session controller"
```

---

## Task 3: SeiMeetingApp UI

**Files:**
- Modify: `features/sei-prototype/networked/SeiMeetingApp.tsx`

Replace the placeholder created in Task 1 with the full UI: a join form (room + display name + signaling URL), a status header (role + connection + signaling state), the same summary panel and sample table as the single-tab prototype, and Start/Stop/Export buttons.

- [ ] **Step 1: Overwrite the placeholder**

Overwrite `features/sei-prototype/networked/SeiMeetingApp.tsx` with the full UI. Use the `Write` tool (not `Edit`), since this is a complete replacement:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startNetworkedSession, type NetworkedSessionHandles } from "./NetworkedSession";
import { createAggregator, type Summary } from "@/features/sei-prototype/logging/tsObservation";
import type { ExportPayload, SampleRow } from "@/features/sei-prototype/metadata/types";
import type { ParticipantRole } from "@/features/webrtc-meeting/protocol/messages";

type Phase = "idle" | "joining" | "running" | "stopping" | "error";

interface FormState {
  signalingUrl: string;
  roomId: string;
  displayName: string;
}

interface UiState {
  phase: Phase;
  errorMessage: string | null;
  summary: Summary;
  rows: SampleRow[];
  elapsedSec: number;
  role: ParticipantRole | null;
  signalingState: "connecting" | "open" | "closed" | "error" | null;
  connectionState: RTCPeerConnectionState;
}

const emptySummary = (): Summary => ({
  framesOut: 0,
  sampled: 0,
  injected: 0,
  hits: 0,
  recvParsed: 0,
  framesDecoded: 0,
  freezeCount: 0,
  passFail: { H1: "pending", H2: "pending", H3: "pending", H4: "pending" },
});

function defaultSignalingUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.hostname) {
    return `ws://${window.location.hostname}:8787`;
  }
  return "ws://localhost:8787";
}

export default function SeiMeetingApp() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<NetworkedSessionHandles | null>(null);
  const aggregatorRef = useRef<ReturnType<typeof createAggregator> | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);

  const [form, setForm] = useState<FormState>(() => ({
    signalingUrl: defaultSignalingUrl(),
    roomId: "sei-test",
    displayName: "Tester",
  }));

  const [ui, setUi] = useState<UiState>({
    phase: "idle",
    errorMessage: null,
    summary: emptySummary(),
    rows: [],
    elapsedSec: 0,
    role: null,
    signalingState: null,
    connectionState: "new",
  });

  const refreshSummary = useCallback(() => {
    const agg = aggregatorRef.current;
    if (!agg) return;
    setUi((prev) => ({
      ...prev,
      summary: agg.getSummary(),
      rows: Array.from(agg.state.rows.values()).sort((a, b) => a.vfTimestampUs - b.vfTimestampUs),
      elapsedSec: startMsRef.current ? Math.floor((Date.now() - startMsRef.current) / 1000) : 0,
    }));
  }, []);

  const handleJoin = useCallback(async () => {
    if (ui.phase === "running" || ui.phase === "joining") return;
    setUi((prev) => ({ ...prev, phase: "joining", errorMessage: null }));

    const aggregator = createAggregator({ onUpdate: () => {} });
    aggregatorRef.current = aggregator;
    aggregator.markStart();
    startMsRef.current = Date.now();

    try {
      const handles = await startNetworkedSession({
        signalingUrl: form.signalingUrl,
        roomId: form.roomId,
        displayName: form.displayName,
        onRawLog: (entry) => aggregator.ingest(entry),
        onRoleAssigned: (role) => setUi((prev) => ({ ...prev, role })),
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            void remoteVideoRef.current.play().catch(() => {});
          }
        },
        onConnectionState: (state) => setUi((prev) => ({ ...prev, connectionState: state })),
        onSignalingState: (state) => setUi((prev) => ({ ...prev, signalingState: state })),
        onError: (err) => setUi((prev) => ({ ...prev, errorMessage: err.message })),
      });
      sessionRef.current = handles;
      aggregator.setEnvSnapshot(handles.envSnapshot);
      aggregator.addStatsSnapshot(await handles.captureStats());

      if (localVideoRef.current && handles.localStream) {
        localVideoRef.current.srcObject = handles.localStream;
        void localVideoRef.current.play().catch(() => {});
      }

      statsIntervalRef.current = window.setInterval(async () => {
        const snap = await handles.captureStats();
        aggregator.addStatsSnapshot(snap);
        const decode = extractDecodeStats(handles.role === "caller" ? snap.pc1 : snap.pc2);
        aggregator.updateDecodeStats(decode);
        const impl = extractEncoderImpl(snap);
        if (impl.encoder || impl.decoder) {
          console.log("[Stats] encoder:", impl.encoder, "decoder:", impl.decoder);
        }
      }, 5_000);
      tickIntervalRef.current = window.setInterval(refreshSummary, 500);

      setUi((prev) => ({ ...prev, phase: "running" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUi((prev) => ({ ...prev, phase: "error", errorMessage: message }));
    }
  }, [form, refreshSummary, ui.phase]);

  const handleStop = useCallback(async () => {
    if (!sessionRef.current) return;
    setUi((prev) => ({ ...prev, phase: "stopping" }));
    if (statsIntervalRef.current !== null) window.clearInterval(statsIntervalRef.current);
    if (tickIntervalRef.current !== null) window.clearInterval(tickIntervalRef.current);
    statsIntervalRef.current = null;
    tickIntervalRef.current = null;
    try {
      const finalSnap = await sessionRef.current.captureStats();
      aggregatorRef.current?.addStatsSnapshot(finalSnap);
      await sessionRef.current.stop();
    } catch { /* ignore */ }
    aggregatorRef.current?.markStop();
    sessionRef.current = null;
    refreshSummary();
    setUi((prev) => ({ ...prev, phase: "idle" }));
  }, [refreshSummary]);

  const handleExport = useCallback(() => {
    if (!aggregatorRef.current) return;
    const payload: ExportPayload = aggregatorRef.current.buildExport();
    const json = JSON.stringify(payload, null, 2);
    void navigator.clipboard.writeText(json).catch(() => {});
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sei-meeting-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    return () => {
      if (statsIntervalRef.current !== null) window.clearInterval(statsIntervalRef.current);
      if (tickIntervalRef.current !== null) window.clearInterval(tickIntervalRef.current);
      void sessionRef.current?.stop();
    };
  }, []);

  return (
    <div className="p-6 text-sm text-[#0f0e1a] dark:text-[#f1f0f6] space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">SEI Networked Verification</h1>
          <p className="opacity-70 text-xs">Open this page in two browser tabs joining the same room.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40"
            disabled={ui.phase === "running" || ui.phase === "joining"}
            onClick={handleJoin}
          >Join</button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40"
            disabled={ui.phase !== "running"}
            onClick={handleStop}
          >Leave</button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40"
            disabled={ui.phase === "idle" && ui.summary.framesOut === 0}
            onClick={handleExport}
          >Export JSON</button>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs opacity-70">Signaling URL</span>
          <input
            className="rounded-md border border-slate-300 dark:border-white/10 bg-transparent px-2 py-1 text-xs font-mono"
            value={form.signalingUrl}
            disabled={ui.phase === "running" || ui.phase === "joining"}
            onChange={(e) => setForm((prev) => ({ ...prev, signalingUrl: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs opacity-70">Room ID</span>
          <input
            className="rounded-md border border-slate-300 dark:border-white/10 bg-transparent px-2 py-1 text-xs font-mono"
            value={form.roomId}
            disabled={ui.phase === "running" || ui.phase === "joining"}
            onChange={(e) => setForm((prev) => ({ ...prev, roomId: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs opacity-70">Display Name</span>
          <input
            className="rounded-md border border-slate-300 dark:border-white/10 bg-transparent px-2 py-1 text-xs font-mono"
            value={form.displayName}
            disabled={ui.phase === "running" || ui.phase === "joining"}
            onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
          />
        </label>
      </section>

      {ui.errorMessage && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-700 dark:text-red-300">
          {ui.errorMessage}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <VideoPanel title={ui.role === "caller" ? "Local preview (caller)" : "Local (no local stream on answerer)"} videoRef={localVideoRef} muted />
        <VideoPanel title={ui.role === "answerer" ? "Remote video (answerer view)" : "Remote video"} videoRef={remoteVideoRef} muted={false} />
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-white/10 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Stat label="Phase" value={ui.phase} />
        <Stat label="Role" value={ui.role ?? "—"} />
        <Stat label="Signaling" value={ui.signalingState ?? "—"} />
        <Stat label="Connection" value={ui.connectionState} />
        <Stat label="Elapsed" value={`${ui.elapsedSec} s`} />
        <Stat label="Frames out (gen)" value={`${ui.summary.framesOut} / sampled ${ui.summary.sampled}`} />
        <Stat label="Sender ETW" value={`injected ${ui.summary.injected} · hits ${ui.summary.hits}`} />
        <Stat label="Receiver parsed" value={`${ui.summary.recvParsed}`} />
        <Stat label="Decoder" value={`framesDecoded=${ui.summary.framesDecoded} · freezeCount=${ui.summary.freezeCount}`} />
        <Stat label="Pass/Fail" value={
          `H1 ${ui.summary.passFail.H1} · H2 ${ui.summary.passFail.H2} · H3 ${ui.summary.passFail.H3} · H4 ${ui.summary.passFail.H4}`
        } />
      </section>

      <SampleTable rows={ui.rows} />
    </div>
  );
}

function VideoPanel({ title, videoRef, muted }: { title: string; videoRef: React.RefObject<HTMLVideoElement>; muted: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 p-3">
      <div className="text-xs opacity-70 mb-2">{title}</div>
      <video ref={videoRef} className="w-full aspect-video bg-black rounded" playsInline autoPlay muted={muted} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="opacity-60">{label}</div>
      <div className="font-mono mt-0.5">{value}</div>
    </div>
  );
}

function SampleTable({ rows }: { rows: SampleRow[] }) {
  if (rows.length === 0) {
    return <div className="text-xs opacity-60">No sampled frames yet. Caller side needs to join first; answerer should see receiver events once frames flow.</div>;
  }
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 overflow-auto max-h-[420px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
          <tr>
            <th className="text-left px-2 py-1">vfTs μs</th>
            <th className="text-left px-2 py-1">batch / frame</th>
            <th className="text-left px-2 py-1">senderMetaTs</th>
            <th className="text-left px-2 py-1">hit?</th>
            <th className="text-left px-2 py-1">selfParse</th>
            <th className="text-left px-2 py-1">recvSEI</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(-200).reverse().map((row) => (
            <tr key={row.vfTimestampUs} className="border-t border-slate-200 dark:border-white/10">
              <td className="px-2 py-1 font-mono">{row.vfTimestampUs}</td>
              <td className="px-2 py-1 font-mono">{row.batchId} / {row.frameId}</td>
              <td className="px-2 py-1 font-mono">{row.senderMetaTimestamp ?? "—"}</td>
              <td className="px-2 py-1">{row.senderHit === undefined ? "—" : row.senderHit ? "✓" : "✗"}</td>
              <td className="px-2 py-1 font-mono">{row.senderSelfParse ? `${row.senderSelfParse.batchId}/${row.senderSelfParse.frameId}` : "—"}</td>
              <td className="px-2 py-1 font-mono">{row.recvSEI ? `${row.recvSEI.batchId}/${row.recvSEI.frameId}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function extractDecodeStats(stats: unknown): { framesDecoded: number; freezeCount: number } {
  let framesDecoded = 0;
  let freezeCount = 0;
  if (Array.isArray(stats)) {
    for (const stat of stats) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "inbound-rtp" && (stat as { kind?: string }).kind === "video") {
        const s = stat as { framesDecoded?: number; freezeCount?: number };
        framesDecoded = s.framesDecoded ?? framesDecoded;
        freezeCount = s.freezeCount ?? freezeCount;
      }
    }
  }
  return { framesDecoded, freezeCount };
}

function extractEncoderImpl(snap: { pc1: unknown; pc2: unknown }): { encoder: string | null; decoder: string | null } {
  let encoder: string | null = null;
  let decoder: string | null = null;
  if (Array.isArray(snap.pc1)) {
    for (const stat of snap.pc1) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "outbound-rtp" && (stat as { kind?: string }).kind === "video") {
        encoder = (stat as { encoderImplementation?: string }).encoderImplementation ?? encoder;
      }
    }
  }
  if (Array.isArray(snap.pc2)) {
    for (const stat of snap.pc2) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "inbound-rtp" && (stat as { kind?: string }).kind === "video") {
        decoder = (stat as { decoderImplementation?: string }).decoderImplementation ?? decoder;
      }
    }
  }
  return { encoder, decoder };
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: only the 3 pre-existing `PeerConnectionEngine.test.ts` errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/networked/SeiMeetingApp.tsx
git commit -m "feat(sei-meeting): join form + role-aware UI"
```

---

## Task 4: Manual Two-Tab Verification

**Files:** (no source changes — manual verification only)

The goal of this task is to answer one question: **does `transform callback #N` appear in either tab's Console once they connect via the signaling server**? That single observation determines whether `RTCRtpScriptTransform` works at all under real WebRTC routing, which in turn decides whether SEI is a viable production capability or whether we need to refactor onto WebCodecs.

- [ ] **Step 1: Start the signaling server in a dedicated terminal**

Run:

```bash
npm run signaling:webrtc
```

Expected: `WebRTC signaling server listening on ws://localhost:8787`. Leave this terminal open.

- [ ] **Step 2: Start the Next.js dev server in a second terminal**

Run:

```bash
npm run dev
```

Expected: `ready started server on 0.0.0.0:3000`. Leave this terminal open.

- [ ] **Step 3: Open Tab A and join**

Open `http://localhost:3000/test/sei-meeting` in Chrome. Open DevTools Console. Click **Join**.

Expected:
- "Phase" goes `idle → joining → running`.
- "Signaling" goes `connecting → open`.
- "Role" displays `caller` (first to join).
- Camera permission prompt appears; allow it.
- Local preview shows the camera feed.
- "Connection" stays `new` or `connecting` because no peer has joined yet.

- [ ] **Step 4: Open Tab B and join the same room**

Open a second Chrome window (or incognito) at the same URL. Make sure the room ID matches Tab A's (`sei-test` by default). Click **Join**.

Expected on Tab B:
- "Role" displays `answerer`.
- "Signaling" `open`.
- Within 2-3 s, "Connection" transitions through `connecting → connected`.
- Remote video panel shows Tab A's camera feed.

Expected on Tab A:
- "Connection" transitions through `connecting → connected`.

- [ ] **Step 5: Watch the Console on both tabs for the diagnostic counter**

In Tab A's Console look for:

```
[Sender ETW] transform callback #1 {type: "key", timestamp: ..., dataByteLength: ...}
[Sender ETW] transform callback #2 ...
[Sender ETW] transform callback #3 ...
```

In Tab B's Console look for:

```
[Recv ETW] transform callback #1 {type: "key", timestamp: ..., dataByteLength: ...}
[Recv ETW] transform callback #2 ...
[Recv ETW] transform callback #3 ...
```

If both lines appear: `RTCRtpScriptTransform` IS working across real signaling. The single-tab same-realm bypass was confirmed as the original blocker. Proceed to Step 6.

If only Tab B's `[Recv ETW]` appears: receiver side works; sender still bypassed. The encoder-side bypass is independent of same-realm. Pause and report.

If neither appears: ScriptTransform is broken at a deeper level on this Chrome version regardless of routing topology. Pause and report — Path B (WebCodecs refactor) is the only remaining option.

- [ ] **Step 6: Verify Pass/Fail panel**

Once `transform callback #N` is firing, the rest of the existing aggregator chain should light up:

On Tab A (caller): `Sender ETW · injected N · hits N` increments above zero.
On Tab B (answerer): `Receiver parsed N` increments above zero.

After ≥30 s of continuous video with no `freezeCount` growth, the Pass/Fail row on each tab should read `H1 pass · H2 pass · H3 pass · H4 pass` (Tab A computes H1/H2; Tab B computes H4; H3 computes on whichever side has inbound RTP).

- [ ] **Step 7: Export JSON from both tabs**

On each tab, click **Export JSON** and save the file. Open Tab A's export and confirm:

- `summary.passFail.H1` is `pass` or `fail` (no longer `pending`).
- `summary.passFail.H2` is `pass` or `fail`.
- `rawLog` contains `sender-etw` entries with `kind: "hit"` or `kind: "miss"`.

Open Tab B's export and confirm:

- `summary.passFail.H4` is `pass` or `fail`.
- `rawLog` contains `recv-etw` entries with `kind: "recv-hit"` or `kind: "recv-miss"`.

- [ ] **Step 8: No commit — verification only**

This task produces no source changes. The exports are the verification artifacts; save them with descriptive filenames (`sei-meeting-caller-<date>.json`, `sei-meeting-answerer-<date>.json`) under `/tmp` or `~/Downloads` for the writeup.

---

## Self-Review Notes (Author)

- **Scope coverage:** Task 1 scaffolds; Task 2 implements the controller (covers both caller and answerer paths in one file because the differences are surgical — one transceiver direction, one optional getUserMedia, one conditional `driveOffer` on `peer-joined`); Task 3 builds the UI (form, role display, summary panel, sample table); Task 4 is the verification workflow with explicit pass/fail criteria.
- **Reuse:** The plan does not redefine the SEI codec, sampling state, workers, metadata channel, aggregator, or signaling client / protocol — all imported as-is.
- **Hard ordering preserved:** Inside `buildCallerPipeline`, the sequence is `addTransceiver` → `setCodecPreferences` → `replaceTrack` → `setParameters` → `sender.transform = ...`. Offer creation happens later when `peer-joined` arrives, so the transform is attached before any SDP negotiation. Inside `buildAnswererPipeline`, `addTransceiver` → `receiver.transform = ...` happens before `setRemoteDescription(offer)` (which is invoked by `handleOffer` later).
- **Same-realm avoided:** Each tab runs only one `RTCPeerConnection`. The bypass that disabled the single-tab prototype is structurally absent.
- **Risk:** The Task 2 controller assumes `peer-joined` is the trigger for the caller to send the offer. If both peers happen to be already in the room when the second one's snapshot arrives, the caller relies on the `snapshot.peer` non-null check at startup to drive the offer immediately. Both paths are covered.
- **No placeholders found** in the plan after a pass.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-25-sei-meeting-networked-verification.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per Task with checkpoint review.
2. **Inline Execution** — execute Tasks in this session via `superpowers:executing-plans`, batched with checkpoints.
