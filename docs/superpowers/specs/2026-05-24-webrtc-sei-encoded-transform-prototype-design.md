# WebRTC EncodedTransform + H.264 SEI prototype design

_Generated: 2026-05-24_

## Goal

Build an isolated browser-only prototype that verifies whether we can inject application-specific metadata (a `batchId` + `frameId` produced by a video-processing worker) into the H.264 SEI of outgoing WebRTC video frames, such that:

1. The injected metadata round-trips through the RTP packetizer/depacketizer.
2. The remote peer's H.264 decoder continues to decode and display video without disruption.
3. The remote peer can extract the metadata back out of the encoded stream.

The prototype is a verification artifact, not a feature. Its output is a set of pass/fail observations recorded in a UI table and an exportable JSON, used to decide whether to graduate this capability into `features/webrtc-meeting/`.

## Hypotheses being verified

| # | Hypothesis | Verified by |
|---|---|---|
| H1 | `RTCEncodedVideoFrameMetadata.timestamp` (PTS μs) on the sender's encoded frame equals the `VideoFrame.timestamp` (PTS μs) we recorded at processing time, so it can serve as the alignment key between two workers. | Per-sample diagnostic row comparing `vfTimestampUs` to `senderMetaTimestamp`. |
| H2 | A standards-conformant SEI NAL (type 6, payload type 5 user_data_unregistered) inserted into `encodedFrame.data` before the first VCL NAL produces a parseable byte stream — verified by self-parsing the modified buffer on the sender side. | Sender-side `injectSei` followed by `parseSei` on the same buffer; result must equal the input payload. |
| H3 | Such SEI insertion does not break the remote peer's decoding — the receiver's `<video>` continues to display picture continuously. | Visual observation + `getStats().framesDecoded` increasing + `freezeCount` not increasing for ≥30s. |
| H4 | The remote peer, given its own `RTCRtpReceiver.transform`, can read the SEI back and recover the exact `{batchId, frameId, vfTimestampUs}` we injected. | Receiver-side parser; payload equality count must equal injection count. |

All four passing ⇒ feasibility confirmed.

## Constraints (locked at brainstorming time)

- **Codec**: H.264 only. Enforced via `RTCRtpTransceiver.setCodecPreferences()` on the sender transceiver before `createOffer`. No SDP munging.
- **Browser scope**: Desktop Chrome only. Insertable Streams / `RTCRtpScriptTransform` behavior on Firefox/Safari is out of scope for this prototype.
- **Topology**: One page, one Chrome tab, two `RTCPeerConnection`s in the same JS realm. No signaling server. Direct SDP and ICE candidate exchange via direct method calls.
- **Sampling**: every 16 s is one batch; within a batch the first 4 s is the sampling window; within the sampling window, 8 sampled frames per second (≈ 32 samples per batch). All other frames pass through untouched.
- **Cache flush**: every 4 s of timeline (driven by `VideoFrame.timestamp`, not wall-clock), the Video Processing Worker sends a `{type:'flush'}` message to the Sender Encoded Transform Worker, which clears its metadata cache. ETW does not run its own timer.
- **No graduation into `features/webrtc-meeting/`** within this prototype. Migration is a follow-up decision.

## File layout

```
app/test/sei-prototype/
└── page.tsx                          # "use client", route entry. Hosts <video>s, controls, summary, table.

features/sei-prototype/
├── SeiPrototypeApp.tsx               # Top-level component; owns pipeline lifecycle and diagnostic store.
├── pipeline/
│   ├── VideoPipelineController.ts    # Builds Processor/Generator/PCs/Workers; wires channels; transfers handles.
│   └── codecPreference.ts            # H.264-only filter for setCodecPreferences().
├── workers/
│   ├── videoProcessing.worker.ts     # Sampling state machine; mock 10 ms processing; metadata + flush signals.
│   └── encodedTransform.worker.ts    # Sender (inject + self-parse) and receiver (parse) roles in one file.
├── sei/
│   ├── h264SeiCodec.ts               # Pure functions: parseNalUnits, encodeSeiRbsp, decodeSeiRbsp, injectSei, parseSei.
│   └── h264SeiCodec.test.ts          # Vitest, no DOM. Covers emulation prevention, payload size, RBSP trailing.
├── metadata/
│   ├── metadataChannel.ts            # Thin MessagePort wrapper with typed messages.
│   └── types.ts                      # FrameMetadata, FlushSignal, SampleRow, RawLogEntry, ExportPayload.
└── logging/
    └── tsObservation.ts              # Main-thread aggregator: merges ④⑤⑥ events into SampleRow by vfTimestampUs.

docs/superpowers/specs/
└── 2026-05-24-webrtc-sei-encoded-transform-prototype-design.md   # This file.
```

## Topology

```
═════════════════ ONE Chrome tab @ /test/sei-prototype ═════════════════

   ┌──────── Sender side ─────────┐         ┌─── Receiver side ───┐
   │ getUserMedia (camera)         │         │                      │
   │       ▼                       │         │                      │
   │ MediaStreamTrackProcessor     │         │                      │
   │       │                       │         │                      │
   │       ▼ readable<VideoFrame>  │         │                      │
   │ ┌─ Video Processing Worker ─┐ │         │                      │
   │ │ sample + mock + reassemble│ │         │                      │
   │ └────────────│──────────────┘ │         │                      │
   │       ▼ writable              │         │                      │
   │ MediaStreamTrackGenerator     │         │                      │
   │       │                       │         │                      │
   │       ▼ track                 │         │                      │
   │ pc1.addTransceiver(...)       │ ──RTP──▶│ pc2.ontrack          │
   │       │                       │  (same  │       ▼              │
   │       ▼  RTCRtpSender         │  realm) │ RTCRtpReceiver       │
   │ ┌─ Encoded Transform W. ──┐   │         │ ┌─ Recv Transform W.┐│
   │ │ inject SEI + self-parse │   │         │ │ extract SEI       ││
   │ └─────────────────────────┘   │         │ └────────│──────────┘│
   │                               │         │          ▼           │
   │                               │         │  <video> element     │
   └───────────────────────────────┘         └──────────────────────┘

   pc1 ↔ pc2: same JS realm, direct exchange of SDP / ICE candidates.
```

## Channels

| # | From | To | Carrier | Contents | Rationale |
|---|---|---|---|---|---|
| ① | VPW | Sender ETW | `MessagePort` (created in main thread, port1 → VPW, port2 → Sender ETW) | `{kind:'metadata', vfTimestampUs, batchId, frameId}` and `{kind:'flush'}` | High-frequency. Avoid main-thread relay. |
| ② | Main | VPW | `MediaStreamTrackProcessor.readable` / `MediaStreamTrackGenerator.writable` | VideoFrame stream | Transferable, standard. |
| ③ | Main | Each ETW | `RTCRtpScriptTransform` constructor (transformer port is created automatically) | EncodedVideoFrame stream | W3C spec. |
| ④ | VPW | Main | Worker default `postMessage` | Per-frame diagnostic (sample decision, original ts, reassembled ts) | Low frequency relative to ①. |
| ⑤ | Sender ETW | Main | Worker default `postMessage` | Per-frame diagnostic (all ts fields, hit/miss, self-parse result) | Low frequency. |
| ⑥ | Receiver ETW | Main | Worker default `postMessage` | Per-frame diagnostic (all ts fields, parsed SEI or null) | Low frequency. |

## Roles

### Main thread (`VideoPipelineController.ts`)

- Owns: `getUserMedia` stream, Processor, Generator, pc1, pc2, three Workers, `<video>` elements.
- Forces H.264 via `setCodecPreferences()` filtered from `RTCRtpSender.getCapabilities('video')` **before** `createOffer`.
- Builds the receiver transceiver with `recvonly` direction and attaches `RTCRtpScriptTransform` to its receiver **before** `setRemoteDescription` on pc2.
- Drives the local offer/answer round-trip and ICE candidate exchange between pc1 and pc2.
- Subscribes to ④⑤⑥, merges by `vfTimestampUs` into a `SampleRow` store, and feeds the UI.

### Video Processing Worker (`videoProcessing.worker.ts`)

- Drains `processor.readable`; for each frame runs a state machine driven by `VideoFrame.timestamp` (μs):
  - Tracks `batchStartUs`, `currentBatchId`, `frameIdInBatch`, `nextSampleUs`, `nextFlushUs`.
  - Each new batch begins when `ts - batchStartUs >= 16_000_000`.
  - A frame is sampled iff `ts - batchStartUs < 4_000_000` AND `ts >= nextSampleUs`; after sampling, `nextSampleUs += 125_000`.
- Sampled frames: allocate an `ArrayBuffer` sized by `frame.allocationSize()`, call `frame.copyTo(buffer)` to extract NV12/I420 raw bytes, await a 10 ms `setTimeout` (mock processing), then construct a new VideoFrame via `new VideoFrame(buffer, { format: frame.format, codedWidth: frame.codedWidth, codedHeight: frame.codedHeight, timestamp: ts, layout: frame.layout })`. The `timestamp` field MUST equal the source frame's timestamp. Write the new frame to `generator.writable`. Close the source frame. Post `{kind:'metadata', vfTimestampUs: ts, batchId, frameId}` on channel ①.
- Non-sampled frames: `writer.write(frame)` directly (transfers ownership).
- Every 4 s of timeline ts (when `ts >= nextFlushUs`), post `{kind:'flush'}` on channel ① and set `nextFlushUs += 4_000_000`.
- Posts a low-volume diagnostic on ④ for every frame.

### Sender Encoded Transform Worker (`encodedTransform.worker.ts`, role=sender)

- Maintains `cache: Map<vfTimestampUs, {batchId, frameId, recordedAtMs}>`.
- On `{kind:'metadata', ...}` from ①: `cache.set(vfTimestampUs, ...)`.
- On `{kind:'flush'}` from ①: `cache.clear()`.
- Runs `RTCRtpScriptTransform`; the transform function for each `encodedFrame`:
  - Reads `meta = encodedFrame.getMetadata()`; key is `Number(meta.timestamp)` (PTS μs).
  - Cache hit ⇒ build payload (UUID + batchId + frameId + vfTimestampUs), call `injectSei(encodedFrame.data, payload)`, assign result back to `encodedFrame.data`, then call `parseSei` on the modified buffer for self-verification.
  - Posts ⑤ with all ts fields (`encodedFrame.timestamp`, `meta.timestamp`, `meta.rtpTimestamp` if present, `meta.frameId`), `hit` flag, self-parse result, and on miss the `nearestKey` field (the cache key with the smallest `|key - lookupKey|`, plus that delta in μs).
  - `controller.enqueue(encodedFrame)` always.

### Receiver Encoded Transform Worker (same file, role=receiver)

- Stateless. For each `encodedFrame`:
  - Calls `parseSei(encodedFrame.data)`; returns null if no matching UUID found.
  - Posts ⑥ with all ts fields and the parsed payload (or null).
  - `controller.enqueue(encodedFrame)` always. **Never** modifies `encodedFrame.data` — preserves picture integrity.

## SEI byte layout

### NAL structure (one access unit)

```
non-keyframe:   [SEI][SLICE]
keyframe:       [SPS][PPS][SEI][IDR_SLICE]
```

Rule: SEI must precede the first VCL NAL (nal_unit_type ∈ {1, 5}). SPS (7) / PPS (8) / AU delimiter (9) remain before SEI.

### One SEI NAL byte image

```
00 00 00 01    — Annex-B 4-byte start code
06             — NAL header: forbidden_zero_bit=0, nal_ref_idc=0, nal_unit_type=6 (SEI)
05             — payload_type = 5 (user_data_unregistered)
20             — payload_size = 32 (single byte, <255)
[16 bytes]     — UUID (fixed constant `SEI_UUID` defined in `metadata/types.ts`; generated once via crypto.randomUUID at design time and committed as a literal byte array)
[ 4 bytes]     — batchId (uint32 BE)
[ 4 bytes]     — frameId (uint32 BE)
[ 8 bytes]     — vfTimestampUs (int64 BE)
80             — RBSP trailing bit (rbsp_stop_one_bit + zero padding to byte boundary)
```

Total: 4 (start code) + 1 + 1 + 1 + 32 + 1 = **40 bytes pre-emulation-prevention**.

### Emulation prevention rule

Applied to the RBSP body (from the NAL header through trailing bits, exclusive of the start code). Whenever two consecutive `0x00` bytes are followed by a third byte ≤ `0x03`, insert a `0x03` between the second `0x00` and the third byte. Reverse: every `00 00 03` sequence has the `03` removed.

Implementation lives in `sei/h264SeiCodec.ts` as `encodeSeiRbsp` / `decodeSeiRbsp`, covered by unit tests.

### Insertion position

Use `parseNalUnits(data)` to scan Annex-B start codes (`00 00 00 01` or `00 00 01`), identify each NAL's `nal_unit_type` from `byte & 0x1F`, find the first VCL NAL (type ∈ {1, 5}), and splice the new SEI NAL immediately before it.

### Sanity check on first frame

On the first encoded frame the Sender ETW receives, log a hex dump of the first 64 bytes of `encodedFrame.data` to ⑤. The expected prefix is `00 00 00 01 XX ...` (Annex-B). If the format is different (e.g., AVCC length-prefixed), the prototype halts and reports — the byte layout assumption fails.

## Sampling state machine (VPW)

```ts
const BATCH_DURATION_US = 16_000_000;
const SAMPLE_WINDOW_US  =  4_000_000;
const SAMPLE_INTERVAL_US =   125_000;
const FLUSH_INTERVAL_US =  4_000_000;

let batchStartUs = -1;
let currentBatchId = 0;
let frameIdInBatch = 0;
let nextSampleUs = 0;
let nextFlushUs = 0;

for await (const frame of reader) {
  const ts = frame.timestamp;

  if (batchStartUs < 0 || ts - batchStartUs >= BATCH_DURATION_US) {
    batchStartUs = ts;
    currentBatchId++;
    frameIdInBatch = 0;
    nextSampleUs = ts;
    nextFlushUs = ts + FLUSH_INTERVAL_US;
  }

  if (ts >= nextFlushUs) {
    metadataPort.postMessage({ kind: 'flush' });
    nextFlushUs += FLUSH_INTERVAL_US;
  }

  const offsetInBatch = ts - batchStartUs;
  const isSamplingWindow = offsetInBatch < SAMPLE_WINDOW_US;
  const isSampleTick = ts >= nextSampleUs;

  if (isSamplingWindow && isSampleTick) {
    frameIdInBatch++;
    nextSampleUs += SAMPLE_INTERVAL_US;
    const reassembled = await mockProcess(frame);   // preserves timestamp
    metadataPort.postMessage({ kind: 'metadata', vfTimestampUs: ts, batchId: currentBatchId, frameId: frameIdInBatch });
    diagnosticsPort.postMessage({ kind: 'vpw-sample', ts, batchId: currentBatchId, frameId: frameIdInBatch });
    await writer.write(reassembled);
    frame.close();
  } else {
    diagnosticsPort.postMessage({ kind: 'vpw-passthrough', ts });
    await writer.write(frame);
  }
}
```

**Invariant**: the reassembled frame's `timestamp` is exactly equal to the source frame's `timestamp`. This is the foundation of the entire alignment hypothesis.

## Startup sequence (timing-critical)

```
1.  new MessageChannel()                              # for channel ①
2.  new Worker × 3
3.  videoProcWorker.postMessage({metadataPort: ch.port1}, [ch.port1])
4.  senderEtWorker.postMessage({metadataPort: ch.port2}, [ch.port2])

5.  getUserMedia → processor → generator
6.  videoProcWorker.postMessage({readable, writable}, [readable, writable])

7.  pc1 = new RTCPeerConnection()
8.  const tx = pc1.addTransceiver('video', {direction:'sendrecv'})
9.  tx.setCodecPreferences(h264OnlyFiltered)          # MUST precede createOffer
10. tx.sender.replaceTrack(genTrack)
11. tx.sender.transform = new RTCRtpScriptTransform(senderEtWorker, {role:'sender'})

12. pc2 = new RTCPeerConnection()
13. const rx = pc2.addTransceiver('video', {direction:'recvonly'})
14. rx.receiver.transform = new RTCRtpScriptTransform(recvEtWorker, {role:'receiver'})   # MUST precede setRemoteDescription

15. pc1.createOffer → pc2.setRemoteDescription → pc2.createAnswer → pc1.setRemoteDescription
16. pc1.onicecandidate ↔ pc2.addIceCandidate (both directions)
17. pc2.ontrack → receiverVideoElement.srcObject = event.streams[0]
```

Two ordering constraints are hard:
- **Step 9 before step 15**: SDP negotiation snapshots codec preferences at offer creation.
- **Step 14 before step 15** (specifically before `pc2.setRemoteDescription`): the receiver transform must be attached before the first encoded frame can arrive, or early frames bypass the transform.

## Observability surface

### Per-sample row

```ts
type SampleRow = {
  vfTimestampUs: number;            // VPW: source frame ts
  newVfTimestampUs?: number;        // VPW: reassembled frame ts (expected ===)
  batchId: number;
  frameId: number;
  vpwAtMs: number;                  // main-thread receive time

  senderHitAtMs?: number;
  senderEncodedTs?: number;         // encodedFrame.timestamp (RTP, 90 kHz)
  senderMetaTimestamp?: number;     // getMetadata().timestamp (PTS μs)
  senderMetaRtpTs?: number;         // getMetadata().rtpTimestamp if exposed
  senderMetaFrameId?: number;       // encoder-assigned, not our frameId
  senderHit?: boolean;
  senderSelfParse?: { batchId: number; frameId: number; vfTimestampUs: number } | null;

  recvAtMs?: number;
  recvEncodedTs?: number;
  recvMetaTimestamp?: number;
  recvMetaRtpTs?: number;
  recvSEI?: { batchId: number; frameId: number; vfTimestampUs: number } | null;
};
```

Non-sampled frames produce only Raw Log entries on ④⑤⑥, never SampleRow.

### UI layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  SEI Encoded Transform Prototype       [Start] [Stop] [Export JSON] │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─ Local preview ─┐  ┌─ Remote <video> ─┐                          │
│  │                 │  │                  │  ← visual proof of decode│
│  └─────────────────┘  └──────────────────┘                          │
│                                                                     │
│  Summary panel:                                                     │
│    Codec negotiated   : H264 packetization-mode=1 profile-level=…   │
│    Elapsed            : mm:ss                                       │
│    Frames out (gen)   : N  sampled: N  non-sampled: N               │
│    Sender ETW         : injected SEI N/N  self-parse OK: N          │
│    Cache              : hit N / miss N of sampled                   │
│    Receiver ETW       : parsed SEI N  matching payload: N           │
│    Receiver decode    : framesDecoded=N  freezeCount=N              │
│    Pass/Fail          : H1 ✓  H2 ✓  H3 ✓  H4 ✓                      │
│                                                                     │
│  Per-sample table (scrollable, one row per sampled frame).          │
│  Raw event log (collapsible, all ④⑤⑥ entries).                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Pass/fail criteria

| Hypothesis | Pass condition | Failure diagnostic |
|---|---|---|
| H1 (ts alignment) | `senderMetaTimestamp === vfTimestampUs` on 100% of sampled rows | Inspect `senderMetaTimestamp - vfTimestampUs` distribution and `senderMetaRtpTs` to determine if there is a fixed linear transform |
| H2 (SEI bytes) | `senderSelfParse` equals the injected payload on 100% of injected frames | Hex-dump the modified buffer; verify emulation prevention; verify NAL parser output |
| H3 (decoder survives) | `framesDecoded` increases monotonically AND `freezeCount` does not increase AND `<video>` displays picture for ≥ 30 s | Failure means SEI insertion breaks the decoder — prototype is FAIL |
| H4 (receiver round-trip) | `recvSEI` equals the injected payload on 100% of sampled rows where `senderHit === true` | Missing rows ⇒ RTP loss; mismatched values ⇒ emulation-prevention asymmetry |

All four ✓ ⇒ feasibility confirmed.

### Stats snapshots

`pc1.getStats()` and `pc2.getStats()` captured at three points: immediately after ICE complete (start baseline), midpoint (~30 s in), and at Stop. Included in the export JSON.

### Environment capture

Included with every export:

- `navigator.userAgent`, derived Chrome major version.
- Negotiated H.264 parameters from the answer SDP: `profile-level-id`, `packetization-mode`, `level-asymmetry-allowed`.
- Camera `getSettings()`: width, height, frameRate, deviceId.
- The three `getStats()` snapshots above.

### Export JSON shape

```json
{
  "env": { "ua": "...", "chromeVersion": "...", "negotiatedCodec": {...}, "cameraSettings": {...} },
  "startedAtMs": 1234567890123,
  "stoppedAtMs": 1234567950123,
  "summary": {
    "framesOut": 2491,
    "sampled": 96,
    "injected": 96,
    "hits": 96,
    "recvParsed": 96,
    "passFail": { "H1": "pass", "H2": "pass", "H3": "pass", "H4": "pass" }
  },
  "samples": [ /* SampleRow[] */ ],
  "rawLog": [ /* { t, src, kind, ...payload }[] */ ],
  "statsSnapshots": [ /* { at, pc1, pc2 }[] */ ]
}
```

Copyable to clipboard via the Export button.

## Out of scope

Explicitly excluded from this prototype:

- Modifications to `features/webrtc-meeting/` or `server/webrtc-signaling/`.
- Real network conditions (NAT, packet loss, congestion).
- Multi-tab signaling, joining real meetings, two-device verification.
- Codecs other than H.264 (VP8/VP9/AV1 have no SEI; H.265 has a different NAL header).
- B-frames or SVC layers (WebRTC H.264 default in Chrome is single-layer, no B-frames).
- Hardware decoder edge cases (desktop Chrome typically uses software OpenH264 for WebRTC).
- Fuzzy timestamp matching in the cache (exact match only; diagnostics reveal deviation if any).
- Receiver-side application logic (the receiver transform only observes, never modifies).
- Persistence (no IndexedDB / localStorage); refresh discards everything.
- Automated assertion / failure popups (operator reads judgments off the UI).
- Server-side reporting (everything stays in the browser).
- Worker crash recovery (any error stops the prototype; logs remain visible).
- Reconnect, codec switch, camera switch, screen share.
- SEI payload sizes ≥ 255 bytes (fixed 32-byte payload; single-byte size field suffices).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `encodedFrame.data` is not Annex-B in this Chrome build | First-frame hex dump sanity check; prototype halts with explicit failure message if format unexpected |
| `RTCEncodedVideoFrameMetadata.timestamp` is implemented as RTP timestamp instead of PTS μs (spec deviation) | Diagnostic table captures both `meta.timestamp` and `meta.rtpTimestamp`; deviation is observable rather than masked |
| Emulation prevention bytes corrupt the parser | Pure-function unit tests cover every byte-pattern edge case; round-trip property test |
| Receiver transform attaches too late and misses early frames | Step 14 in the startup sequence is documented as hard-precedence over step 15 |
| Codec negotiation does not pick H.264 (e.g., capability filter returns empty) | Controller logs the filtered codec list at startup; halts if empty |
| Hardware decoder rejects unknown SEI (desktop Chrome edge case) | H3 (receiver decode survives) is itself the empirical check; failure is a valid prototype outcome |

## Verification workflow

1. `npm run dev`
2. Open `http://localhost:3000/test/sei-prototype` in Chrome.
3. Allow camera permission. Click **Start**.
4. Watch the Remote `<video>` for ≥ 30 s for continuous picture.
5. Watch the per-sample table — confirm `hit?` and `recvSEI?` columns show ✓.
6. Read the pass/fail row at the top of the Summary panel.
7. Click **Stop**, then **Export JSON**. Save the JSON for the writeup.
8. Repeat ≥ 3 times across separate camera sessions to confirm stability.

## Follow-up decisions (not part of this prototype)

After prototype completion:

- If all four hypotheses pass: decide whether to extract `sei/h264SeiCodec.ts`, parts of `workers/encodedTransform.worker.ts`, and a refactored version of `pipeline/VideoPipelineController.ts` into `features/webrtc-meeting/`, with `PeerConnectionEngine` gaining an opt-in `enableEncodedTransform` option.
- If H1 fails specifically: investigate whether to use the observed timestamp transform (fixed offset or linear function) and adjust the cache key; document the deviation as a finding.
- If H3 fails: investigate per-Chrome-version, per-platform variance; do not graduate the capability.

## Implementation handoff

This document defines the design surface. A separate implementation plan (under `docs/superpowers/plans/`) will sequence the build into testable steps with TDD-friendly checkpoints. The plan must respect every constraint and ordering rule in this document; deviations require updating this document first.

---

## Findings (2026-05-25, post-implementation)

The prototype as designed above was implemented (commits between `eea7243` and `0992cf7`) and exercised across two topologies and two platforms. **The central architectural assumption — that `RTCRtpScriptTransform` lets JavaScript intercept the encoded H.264 byte stream on the wire — does not hold on current Chrome stable, on any platform we tested.** The other three hypotheses (H2 SEI bytes, H3 decoder survival, H4 receiver round-trip) are therefore unreachable through this code path.

### What was verified empirically

| Configuration | Result |
|---|---|
| macOS Chrome 148, single tab, dual `RTCPeerConnection` in same JS realm, VideoToolbox HW encoder | `onrtctransform` fires; `transformer.readable` never emits any frame. `framesEncoded > 0` and pc2 `framesDecoded > 0` while the transform stays empty. |
| macOS Chrome 148, single tab, dual `RTCPeerConnection` in same JS realm, OpenH264 SW encoder (forced via `setParameters` with `maxBitrate: 200_000, scaleResolutionDownBy: 4`) | Same as above. Encoder switch had no effect on transform delivery. |
| macOS Chrome 148, **two browser windows + real WebSocket signaling via `server/webrtc-signaling/`**, OpenH264 SW encoder | Same as above. ICE/DTLS completes (`pc.connectionState === "connected"`), encoded RTP bytes flow on the wire, but the worker `transform(frame, controller)` callback is never invoked. |
| Windows Chrome (current stable), two browser windows + signaling, same configuration | Same as above. Cross-platform identical behavior. |

In every configuration:
- `typeof RTCRtpScriptTransform === "function"` ✓
- `"transform" in RTCRtpSender.prototype` ✓
- `tx.sender.transform = new RTCRtpScriptTransform(worker, {role: "sender"})` succeeds without exception ✓
- The worker's `self.onrtctransform = (event) => { ... }` handler fires and the `transformer` object is constructed correctly ✓
- `transformer.readable.pipeThrough(...).pipeTo(transformer.writable)` resolves the pipe chain with no error and no completion ✓
- ❌ **No encoded frame is ever delivered to the user-defined `transform()` callback.**

### Verdict against the original hypotheses

| # | Hypothesis | Verdict | Reason |
|---|---|---|---|
| H1 | `meta.timestamp` on encoded frames equals `VideoFrame.timestamp` | **UNREACHABLE** | We cannot read `meta.timestamp` because the transform callback never fires. The underlying μs-PTS preservation may or may not hold in Chrome's internal pipeline; this prototype cannot answer it. |
| H2 | SEI NAL injected into `encodedFrame.data` self-parses correctly | **UNREACHABLE** (same reason) |
| H3 | SEI insertion does not break remote decoding | **UNTESTED but irrelevant** because we cannot inject in the first place. |
| H4 | Receiver `parseSei` recovers the injected payload | **UNREACHABLE** (same reason) |

### Root cause hypothesis (not directly verified)

Chrome's WebRTC implementation appears to satisfy the *spec surface* of `RTCRtpScriptTransform` (constructor, property, event dispatch, transformer object) but does not actually wire the encoder output through `transformer.readable` for H.264 video. The same wiring may or may not work for VP8/VP9/AV1, or for the audio side — that was not tested.

### Engineering implications for the SEI metadata-channel goal

- **Path A (use `RTCRtpScriptTransform` to inject SEI into the WebRTC encoder's H.264 output)** — **not viable on Chrome today**. Re-test only after a future Chrome version explicitly fixes encoded-transform routing for H.264 (track [Chromium Issues](https://issues.chromium.org/) under `Blink>WebRTC>EncodedTransform`).
- **Path B (self-managed encoder via WebCodecs `VideoEncoder` + custom transport via `RTCDataChannel`)** — viable, with the trade-off of losing WebRTC's jitter buffer, NACK, and FEC, which must be re-implemented or accepted as quality loss. This is the only path that gives JS unconditional access to the H.264 byte stream on current Chrome.
- **Path C (side-channel metadata via `RTCDataChannel` alongside the normal media track)** — viable and much simpler than B. Loses byte-level SEI alignment but preserves WebRTC media quality. Alignment via `VideoFrame.timestamp` ↔ a parallel timestamp channel on the data channel; works as long as the receiver can correlate the data-channel message to the rendered frame's PTS.

### Preserved artifacts

- `public/sei-rtc-test.html` — standalone diagnostic page that reproduces the finding. Self-contained (worker via Blob URL, talks directly to the existing signaling server). Future Chrome retest: open in two windows with the same Room ID, watch the EncodedTransform status banner.
- `docs/superpowers/plans/2026-05-25-webrtc-sei-encoded-transform-prototype.md` — original implementation plan (executed; code subsequently removed in `0992cf7` after the finding).
- `docs/superpowers/plans/2026-05-25-sei-meeting-networked-verification.md` — networked-verification plan (D1–D3 implemented to rule out same-realm bypass; code removed in the same commit).
