# WebRTC SEI EncodedTransform Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Chrome-only prototype at `/test/sei-prototype` that verifies whether H.264 SEI NAL units can carry application metadata (`batchId` / `frameId` / `vfTimestampUs`) round-trip through a same-realm WebRTC sender/receiver pair via `RTCRtpScriptTransform`, without breaking remote decoding.

**Architecture:** Add an independent `features/sei-prototype` module mounted by `app/test/sei-prototype/page.tsx`. Sender path: `getUserMedia` → `MediaStreamTrackProcessor` → Video Processing Worker (16 s batch, 4 s sampling window, 125 ms sample tick) → `MediaStreamTrackGenerator` → `pc1` sender + Sender Encoded Transform Worker (Annex-B SEI inject + self-parse). Receiver path: `pc2` → Receiver Encoded Transform Worker (parse-only) → `<video>`. A `MessageChannel` (channel ①) carries `{vfTimestampUs, batchId, frameId}` and flush signals from VPW to Sender ETW, keyed by `Number(meta.timestamp)` on the encoded side. Diagnostic events ④⑤⑥ flow to the main thread for `SampleRow` merging and JSON export. H.264 is forced via `setCodecPreferences()` before `createOffer`; the receiver `transform` is attached before `setRemoteDescription`.

**Tech Stack:** Next.js 14 App Router (client component), React 18, TypeScript strict, lucide-react icons, WebRTC + WebCodecs + Insertable Streams browser APIs, Vitest for pure-function unit tests.

---

## File Structure

- Create `app/test/sei-prototype/page.tsx`: `"use client"` route entry, dynamically imports `SeiPrototypeApp` with `ssr: false`.
- Create `features/sei-prototype/SeiPrototypeApp.tsx`: top-level component, owns pipeline lifecycle, diagnostic store, UI sections.
- Create `features/sei-prototype/types.d.ts`: ambient declarations for Web APIs that ship without TypeScript lib coverage (`MediaStreamTrackProcessor`, `MediaStreamTrackGenerator`, `RTCRtpScriptTransform`, `RTCEncodedVideoFrame`, `RTCEncodedVideoFrameMetadata`).
- Create `features/sei-prototype/metadata/types.ts`: shared runtime types (`FrameMetadata`, `FlushSignal`, `SampleRow`, `RawLogEntry`, `ExportPayload`, `SEI_UUID_BYTES`, `PassFailVerdict`).
- Create `features/sei-prototype/metadata/metadataChannel.ts`: thin typed `MessagePort` wrapper used by VPW and Sender ETW.
- Create `features/sei-prototype/sei/h264SeiCodec.ts`: pure functions — `escapeEmulationPrevention`, `unescapeEmulationPrevention`, `parseAnnexBNalUnits`, `buildSeiNal`, `extractSeiPayload`, `injectSei`, `parseSei`, `encodeSeiPayload`, `decodeSeiPayload`.
- Create `features/sei-prototype/sei/h264SeiCodec.test.ts`: Vitest unit tests covering emulation-prevention round-trip, NAL parser, payload codec, full inject/parse round-trip.
- Create `features/sei-prototype/sei/samplingState.ts`: pure state machine for the VPW (`createSamplingState`, `stepSampling`).
- Create `features/sei-prototype/sei/samplingState.test.ts`: Vitest unit tests for batch/window/tick decisions.
- Create `features/sei-prototype/pipeline/codecPreference.ts`: `pickH264Codecs(capabilities)` filter.
- Create `features/sei-prototype/pipeline/codecPreference.test.ts`: filter tests.
- Create `features/sei-prototype/pipeline/VideoPipelineController.ts`: builds Processor/Generator/PCs/Workers, wires ports, runs SDP/ICE exchange between pc1 and pc2, exposes start/stop/getStats and diagnostic event subscription.
- Create `features/sei-prototype/workers/videoProcessing.worker.ts`: drains Processor reader, runs `stepSampling`, optionally reassembles via `frame.copyTo` + mock 10 ms processing, writes to Generator, posts metadata/flush over channel ① and diagnostics over default `postMessage`.
- Create `features/sei-prototype/workers/encodedTransform.worker.ts`: handles both sender and receiver roles selected via `event.transformer.options.role`; sender injects SEI on cache hit and self-parses; receiver parses SEI only (never mutates `encodedFrame.data`).
- Create `features/sei-prototype/logging/tsObservation.ts`: main-thread aggregator that merges ④⑤⑥ raw events by `vfTimestampUs` into a `SampleRow` map and a `RawLogEntry[]` ring buffer, exposes `subscribe`, `getRows`, `getRawLog`, `getSummary`, `buildExport`.
- Modify `config/testPages.ts`: add a `sei-prototype` entry with icon `TestTube`, category `Debug`.

No other files in the repository are modified. The lucide icon `TestTube` is already imported in `app/page.tsx`, so the icon map needs no change.

---

## Conventions Used Throughout The Plan

- Vitest specs live next to their source file as `<name>.test.ts`. Tests run in Node (the default Vitest environment) — none of the planned tests require DOM.
- All TypeScript files are strict-mode safe (no implicit `any`, no `as any` shortcuts unless explicitly noted in a step).
- Each Task ends with a `git add` of just the files the Task created or modified followed by a single `git commit`. Never `git add .` / `git add -A`.
- Worker files use the modern `new Worker(new URL("./xxx.worker.ts", import.meta.url), { type: "module" })` pattern, which Next.js 14 / webpack 5 supports out of the box.
- For runtime types that TypeScript's `lib.dom` does not ship (Insertable Streams etc.), the ambient file `features/sei-prototype/types.d.ts` provides minimal declarations sufficient for type-checking. Never widen lib.dom globally.
- `console.*` calls inside workers and the controller use a `prefix` string (`"[VPW]"`, `"[Sender ETW]"`, `"[Recv ETW]"`, `"[Pipeline]"`) so the Chrome devtools console makes the source obvious.

---

## Task 1: Foundations — Route Page, Test Pages Registration, Type Shims

**Files:**
- Create: `app/test/sei-prototype/page.tsx`
- Create: `features/sei-prototype/types.d.ts`
- Create: `features/sei-prototype/SeiPrototypeApp.tsx` (placeholder)
- Modify: `config/testPages.ts`

- [ ] **Step 1: Add the test-pages registration entry**

Edit `config/testPages.ts` and append the following object to the `testPages` array (place it after the `browser-capability` entry, keeping the closing `];`):

```ts
,
  {
    id: "sei-prototype",
    title: "SEI Prototype",
    description: "H.264 SEI EncodedTransform round-trip prototype (Chrome only)",
    icon: "TestTube",
    path: "/test/sei-prototype",
    category: "Debug"
  }
```

- [ ] **Step 2: Create the ambient type shim**

Create `features/sei-prototype/types.d.ts` with the following contents:

```ts
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
```

- [ ] **Step 3: Create a placeholder SeiPrototypeApp**

Create `features/sei-prototype/SeiPrototypeApp.tsx`:

```tsx
"use client";

export default function SeiPrototypeApp() {
  return (
    <div className="p-6 text-sm text-[#0f0e1a] dark:text-[#f1f0f6]">
      <h1 className="text-xl font-semibold mb-2">SEI EncodedTransform Prototype</h1>
      <p className="opacity-70">Scaffold loaded. Pipeline UI arrives in a later task.</p>
    </div>
  );
}
```

- [ ] **Step 4: Create the route page**

Create `app/test/sei-prototype/page.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";

const SeiPrototypeApp = dynamic(
  () => import("@/features/sei-prototype/SeiPrototypeApp"),
  { ssr: false }
);

export default function SeiPrototypePage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-2xl border border-[#ede9f8] dark:border-white/[0.06] bg-white dark:bg-[#0e0e12]">
      <SeiPrototypeApp />
    </div>
  );
}
```

- [ ] **Step 5: Type-check the new files**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors. If errors reference `RTCRtpScriptTransform` or `MediaStreamTrackProcessor`, double-check `features/sei-prototype/types.d.ts` was included in `tsconfig.json`'s `include` glob (`"**/*.ts"` already matches `.d.ts` files since the glob covers all TS files; verify with `grep "**/*.ts" tsconfig.json`).

- [ ] **Step 6: Commit the scaffolding**

```bash
git add app/test/sei-prototype/page.tsx features/sei-prototype/SeiPrototypeApp.tsx features/sei-prototype/types.d.ts config/testPages.ts
git commit -m "feat(sei-prototype): scaffold route and ambient types"
```

---

## Task 2: Shared Runtime Types And SEI UUID Constant

**Files:**
- Create: `features/sei-prototype/metadata/types.ts`

- [ ] **Step 1: Author the shared types file**

Create `features/sei-prototype/metadata/types.ts` with the following contents:

```ts
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
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/metadata/types.ts
git commit -m "feat(sei-prototype): add shared types and SEI UUID constant"
```

---

## Task 3: H.264 SEI Codec — Emulation Prevention (TDD)

**Files:**
- Create: `features/sei-prototype/sei/h264SeiCodec.ts`
- Create: `features/sei-prototype/sei/h264SeiCodec.test.ts`

- [ ] **Step 1: Write the failing emulation-prevention tests**

Create `features/sei-prototype/sei/h264SeiCodec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  escapeEmulationPrevention,
  unescapeEmulationPrevention,
} from "./h264SeiCodec";

const u = (...bytes: number[]) => Uint8Array.from(bytes);

describe("h264 emulation prevention", () => {
  it("inserts 0x03 between two 0x00 and a low third byte", () => {
    expect(escapeEmulationPrevention(u(0x00, 0x00, 0x00))).toEqual(
      u(0x00, 0x00, 0x03, 0x00),
    );
    expect(escapeEmulationPrevention(u(0x00, 0x00, 0x01))).toEqual(
      u(0x00, 0x00, 0x03, 0x01),
    );
    expect(escapeEmulationPrevention(u(0x00, 0x00, 0x02))).toEqual(
      u(0x00, 0x00, 0x03, 0x02),
    );
    expect(escapeEmulationPrevention(u(0x00, 0x00, 0x03))).toEqual(
      u(0x00, 0x00, 0x03, 0x03),
    );
  });

  it("does not escape when third byte is greater than 0x03", () => {
    expect(escapeEmulationPrevention(u(0x00, 0x00, 0x04))).toEqual(
      u(0x00, 0x00, 0x04),
    );
  });

  it("escapes a trailing pair of 0x00 by appending 0x03", () => {
    expect(escapeEmulationPrevention(u(0x00, 0x00))).toEqual(
      u(0x00, 0x00, 0x03),
    );
  });

  it("escapes multiple non-overlapping windows", () => {
    expect(
      escapeEmulationPrevention(u(0x00, 0x00, 0x01, 0x00, 0x00, 0x02)),
    ).toEqual(u(0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x03, 0x02));
  });

  it("unescape is the inverse of escape for arbitrary byte strings", () => {
    const samples: Uint8Array[] = [
      u(),
      u(0xff),
      u(0x00, 0x00, 0x01, 0x02, 0x03),
      u(0x00, 0x00, 0x00, 0x00, 0x00),
      u(0xde, 0xad, 0xbe, 0xef),
      u(0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00, 0x00, 0x04),
    ];
    for (const sample of samples) {
      const round = unescapeEmulationPrevention(
        escapeEmulationPrevention(sample),
      );
      expect(Array.from(round)).toEqual(Array.from(sample));
    }
  });
});
```

- [ ] **Step 2: Verify the tests fail because the module does not exist**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: Vitest reports `Failed to load url ./h264SeiCodec` (or equivalent module-not-found). This confirms tests are running and the file is the next thing to create.

- [ ] **Step 3: Implement emulation prevention**

Create `features/sei-prototype/sei/h264SeiCodec.ts` with just the two functions for now (more added in later tasks):

```ts
export function escapeEmulationPrevention(rbsp: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (let i = 0; i < rbsp.length; i++) {
    const byte = rbsp[i];
    if (zeros >= 2 && byte <= 0x03) {
      out.push(0x03);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0x00 ? zeros + 1 : 0;
  }
  // Guard against a trailing 0x00 0x00 pair that would form an Annex-B
  // start-code emulation when concatenated with subsequent NALs.
  if (zeros >= 2) {
    out.push(0x03);
  }
  return Uint8Array.from(out);
}

export function unescapeEmulationPrevention(ebsp: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (let i = 0; i < ebsp.length; i++) {
    const byte = ebsp[i];
    if (zeros >= 2 && byte === 0x03 && i + 1 < ebsp.length && ebsp[i + 1] <= 0x03) {
      zeros = 0;
      continue; // drop the 0x03 emulation prevention byte
    }
    out.push(byte);
    zeros = byte === 0x00 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}
```

- [ ] **Step 4: Verify the tests pass**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add features/sei-prototype/sei/h264SeiCodec.ts features/sei-prototype/sei/h264SeiCodec.test.ts
git commit -m "feat(sei-prototype): h264 emulation prevention codec"
```

---

## Task 4: H.264 SEI Codec — Annex-B NAL Parser (TDD)

**Files:**
- Modify: `features/sei-prototype/sei/h264SeiCodec.ts`
- Modify: `features/sei-prototype/sei/h264SeiCodec.test.ts`

- [ ] **Step 1: Append the failing NAL-parser tests**

Append the following `describe` block to `features/sei-prototype/sei/h264SeiCodec.test.ts`:

```ts
import { parseAnnexBNalUnits } from "./h264SeiCodec";

describe("annex-b NAL parser", () => {
  const u = (...bytes: number[]) => Uint8Array.from(bytes);

  it("splits on 4-byte start codes", () => {
    const stream = u(
      0x00, 0x00, 0x00, 0x01, 0x67, 0xaa,           // SPS-ish
      0x00, 0x00, 0x00, 0x01, 0x68, 0xbb,           // PPS-ish
      0x00, 0x00, 0x00, 0x01, 0x65, 0xcc, 0xdd,     // IDR slice
    );
    const nals = parseAnnexBNalUnits(stream);
    expect(nals).toHaveLength(3);
    expect(nals[0].nalType).toBe(7);
    expect(nals[1].nalType).toBe(8);
    expect(nals[2].nalType).toBe(5);
    expect(Array.from(nals[2].body)).toEqual([0x65, 0xcc, 0xdd]);
    expect(nals[2].startCodeLength).toBe(4);
  });

  it("splits on 3-byte start codes", () => {
    const stream = u(
      0x00, 0x00, 0x01, 0x09, 0x10,                 // AU delimiter
      0x00, 0x00, 0x01, 0x21, 0x42,                 // non-IDR slice
    );
    const nals = parseAnnexBNalUnits(stream);
    expect(nals).toHaveLength(2);
    expect(nals[0].nalType).toBe(9);
    expect(nals[1].nalType).toBe(1);
    expect(nals[0].startCodeLength).toBe(3);
  });

  it("returns an empty array when no start code is found", () => {
    expect(parseAnnexBNalUnits(u(0xff, 0xff, 0xff))).toEqual([]);
  });

  it("exposes the absolute byte offset of each NAL header", () => {
    const stream = u(
      0x00, 0x00, 0x00, 0x01, 0x67, 0xaa,
      0x00, 0x00, 0x01, 0x65, 0xbb,
    );
    const nals = parseAnnexBNalUnits(stream);
    expect(nals[0].nalHeaderOffset).toBe(4);
    expect(nals[1].nalHeaderOffset).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: failure with `parseAnnexBNalUnits is not a function` (or equivalent).

- [ ] **Step 3: Implement the parser**

Append the following to `features/sei-prototype/sei/h264SeiCodec.ts`:

```ts
export interface AnnexBNalUnit {
  // Length of the start code that prefixes this NAL (3 or 4).
  startCodeLength: 3 | 4;
  // Absolute offset (into the source buffer) of the NAL header byte.
  nalHeaderOffset: number;
  // Length of the NAL body including its header (i.e., bytes after the
  // start code up to but not including the next start code).
  bodyLength: number;
  // NAL header byte & 0x1F.
  nalType: number;
  // Slice into the source buffer covering header + payload (no start code).
  body: Uint8Array;
}

function findStartCode(buf: Uint8Array, from: number): { offset: number; length: 3 | 4 } | null {
  for (let i = from; i + 2 < buf.length; i++) {
    if (buf[i] !== 0x00 || buf[i + 1] !== 0x00) continue;
    if (buf[i + 2] === 0x01) return { offset: i, length: 3 };
    if (buf[i + 2] === 0x00 && i + 3 < buf.length && buf[i + 3] === 0x01) {
      return { offset: i, length: 4 };
    }
  }
  return null;
}

export function parseAnnexBNalUnits(buf: Uint8Array): AnnexBNalUnit[] {
  const out: AnnexBNalUnit[] = [];
  let cursor = 0;
  let first = findStartCode(buf, cursor);
  while (first) {
    const headerOffset = first.offset + first.length;
    if (headerOffset >= buf.length) break;
    const next = findStartCode(buf, headerOffset);
    const endOffset = next ? next.offset : buf.length;
    out.push({
      startCodeLength: first.length,
      nalHeaderOffset: headerOffset,
      bodyLength: endOffset - headerOffset,
      nalType: buf[headerOffset] & 0x1f,
      body: buf.subarray(headerOffset, endOffset),
    });
    if (!next) break;
    first = next;
    cursor = next.offset;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: all tests (including emulation-prevention) pass.

- [ ] **Step 5: Commit**

```bash
git add features/sei-prototype/sei/h264SeiCodec.ts features/sei-prototype/sei/h264SeiCodec.test.ts
git commit -m "feat(sei-prototype): annex-b NAL parser"
```

---

## Task 5: H.264 SEI Codec — Payload Encode/Decode (TDD)

**Files:**
- Modify: `features/sei-prototype/sei/h264SeiCodec.ts`
- Modify: `features/sei-prototype/sei/h264SeiCodec.test.ts`

- [ ] **Step 1: Append the failing payload tests**

Append the following block to `features/sei-prototype/sei/h264SeiCodec.test.ts`:

```ts
import { encodeSeiPayload, decodeSeiPayload } from "./h264SeiCodec";
import { SEI_PAYLOAD_BYTES, SEI_UUID_BYTES } from "@/features/sei-prototype/metadata/types";

describe("sei payload codec", () => {
  it("encodes UUID + batchId + frameId + vfTimestampUs in big-endian", () => {
    const bytes = encodeSeiPayload({ batchId: 0x01020304, frameId: 0x05060708, vfTimestampUs: 0x090a0b0c0d0e0f10n });
    expect(bytes.length).toBe(SEI_PAYLOAD_BYTES);
    expect(Array.from(bytes.subarray(0, 16))).toEqual([...SEI_UUID_BYTES]);
    expect(Array.from(bytes.subarray(16, 20))).toEqual([0x01, 0x02, 0x03, 0x04]);
    expect(Array.from(bytes.subarray(20, 24))).toEqual([0x05, 0x06, 0x07, 0x08]);
    expect(Array.from(bytes.subarray(24, 32))).toEqual([
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    ]);
  });

  it("decodes back to the same values", () => {
    const input = { batchId: 7, frameId: 32, vfTimestampUs: 1_234_567_890_123n };
    const decoded = decodeSeiPayload(encodeSeiPayload(input));
    expect(decoded).toEqual({ batchId: 7, frameId: 32, vfTimestampUs: 1_234_567_890_123 });
  });

  it("returns null when the UUID prefix does not match", () => {
    const bogus = new Uint8Array(SEI_PAYLOAD_BYTES);
    bogus.set([0xaa, 0xbb, 0xcc, 0xdd], 0);
    expect(decodeSeiPayload(bogus)).toBeNull();
  });

  it("returns null when payload is too short", () => {
    expect(decodeSeiPayload(new Uint8Array(10))).toBeNull();
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: failure on `encodeSeiPayload is not a function`.

- [ ] **Step 3: Implement payload encode/decode**

Append the following to `features/sei-prototype/sei/h264SeiCodec.ts`:

```ts
import { SEI_PAYLOAD_BYTES, SEI_UUID_BYTES, type SeiPayload } from "@/features/sei-prototype/metadata/types";

export interface EncodeSeiPayloadInput {
  batchId: number;
  frameId: number;
  vfTimestampUs: number | bigint;
}

export function encodeSeiPayload(input: EncodeSeiPayloadInput): Uint8Array {
  const out = new Uint8Array(SEI_PAYLOAD_BYTES);
  out.set(SEI_UUID_BYTES, 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(16, input.batchId >>> 0, false);
  view.setUint32(20, input.frameId >>> 0, false);
  const ts = typeof input.vfTimestampUs === "bigint"
    ? input.vfTimestampUs
    : BigInt(input.vfTimestampUs);
  view.setBigInt64(24, ts, false);
  return out;
}

export function decodeSeiPayload(payload: Uint8Array): SeiPayload | null {
  if (payload.length < SEI_PAYLOAD_BYTES) return null;
  for (let i = 0; i < 16; i++) {
    if (payload[i] !== SEI_UUID_BYTES[i]) return null;
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    batchId: view.getUint32(16, false),
    frameId: view.getUint32(20, false),
    vfTimestampUs: Number(view.getBigInt64(24, false)),
  };
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add features/sei-prototype/sei/h264SeiCodec.ts features/sei-prototype/sei/h264SeiCodec.test.ts
git commit -m "feat(sei-prototype): SEI payload codec"
```

---

## Task 6: H.264 SEI Codec — Inject And Parse Round-Trip (TDD)

**Files:**
- Modify: `features/sei-prototype/sei/h264SeiCodec.ts`
- Modify: `features/sei-prototype/sei/h264SeiCodec.test.ts`

- [ ] **Step 1: Append the failing inject/parse tests**

Append the following block to `features/sei-prototype/sei/h264SeiCodec.test.ts`:

```ts
import { injectSei, parseSei } from "./h264SeiCodec";

describe("sei inject and parse", () => {
  const u = (...bytes: number[]) => Uint8Array.from(bytes);

  it("inserts an SEI NAL before the first VCL NAL in a non-key access unit", () => {
    const original = u(0x00, 0x00, 0x00, 0x01, 0x21, 0xab, 0xcd); // type 1 slice
    const payload = { batchId: 1, frameId: 2, vfTimestampUs: 3 };
    const out = injectSei(original.buffer.slice(0), payload);
    const view = new Uint8Array(out);
    // First six bytes are the new SEI: 00 00 00 01 06 05
    expect(Array.from(view.subarray(0, 6))).toEqual([0x00, 0x00, 0x00, 0x01, 0x06, 0x05]);
    // The original slice's first byte (0x21) must still appear after the SEI.
    expect(view).toContain(0x21);
  });

  it("inserts SEI between PPS and IDR in a key access unit (preserves SPS/PPS order)", () => {
    const original = u(
      0x00, 0x00, 0x00, 0x01, 0x67, 0xaa, 0xbb, // SPS (type 7)
      0x00, 0x00, 0x00, 0x01, 0x68, 0xcc,       // PPS (type 8)
      0x00, 0x00, 0x00, 0x01, 0x65, 0xee, 0xff, // IDR (type 5)
    );
    const out = new Uint8Array(injectSei(original.buffer.slice(0), { batchId: 9, frameId: 9, vfTimestampUs: 9 }));
    // SPS still first
    expect(Array.from(out.subarray(0, 7))).toEqual([0x00, 0x00, 0x00, 0x01, 0x67, 0xaa, 0xbb]);
    // PPS still second
    expect(Array.from(out.subarray(7, 13))).toEqual([0x00, 0x00, 0x00, 0x01, 0x68, 0xcc]);
    // SEI third
    expect(Array.from(out.subarray(13, 19))).toEqual([0x00, 0x00, 0x00, 0x01, 0x06, 0x05]);
  });

  it("round-trips an injected payload via parseSei", () => {
    const original = u(0x00, 0x00, 0x00, 0x01, 0x21, 0xab);
    const payload = { batchId: 42, frameId: 7, vfTimestampUs: 9_999_999 };
    const injected = injectSei(original.buffer.slice(0), payload);
    expect(parseSei(injected)).toEqual(payload);
  });

  it("parseSei returns null when the buffer has no matching SEI", () => {
    const original = u(0x00, 0x00, 0x00, 0x01, 0x21, 0xab);
    expect(parseSei(original.buffer.slice(0))).toBeNull();
  });

  it("emulation prevention survives across the round-trip when payload contains 0x00 0x00 0x00", () => {
    // batchId is 0 and frameId is 0 → encodeSeiPayload produces 0x00*4 0x00*4 sequences.
    const payload = { batchId: 0, frameId: 0, vfTimestampUs: 0 };
    const original = u(0x00, 0x00, 0x00, 0x01, 0x21, 0xab);
    const out = injectSei(original.buffer.slice(0), payload);
    const decoded = parseSei(out);
    expect(decoded).toEqual(payload);
  });
});
```

- [ ] **Step 2: Confirm it fails**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: failure on `injectSei is not a function`.

- [ ] **Step 3: Implement injectSei and parseSei**

Append the following to `features/sei-prototype/sei/h264SeiCodec.ts`:

```ts
const SEI_NAL_HEADER = 0x06; // forbidden_zero_bit=0, nal_ref_idc=0, nal_unit_type=6
const PAYLOAD_TYPE_USER_DATA_UNREGISTERED = 0x05;
const RBSP_TRAILING = 0x80;
const VCL_NAL_TYPES = new Set([1, 5]); // non-IDR slice and IDR slice

function isVclNal(nalType: number): boolean {
  return VCL_NAL_TYPES.has(nalType);
}

function buildSeiNal(payload: Uint8Array): Uint8Array {
  // RBSP body: NAL header + payload_type + payload_size + payload + rbsp_trailing.
  const rbsp = new Uint8Array(3 + payload.length + 1);
  rbsp[0] = SEI_NAL_HEADER;
  rbsp[1] = PAYLOAD_TYPE_USER_DATA_UNREGISTERED;
  rbsp[2] = payload.length & 0xff; // payload < 255 — single byte size field
  rbsp.set(payload, 3);
  rbsp[rbsp.length - 1] = RBSP_TRAILING;
  // Emulation prevention applies to NAL header + payload bytes, not the
  // start code itself. Wrap that contiguous slice.
  const ebsp = escapeEmulationPrevention(rbsp);
  const out = new Uint8Array(4 + ebsp.length);
  out[0] = 0x00; out[1] = 0x00; out[2] = 0x00; out[3] = 0x01; // Annex-B start code
  out.set(ebsp, 4);
  return out;
}

export function injectSei(data: ArrayBuffer, payload: EncodeSeiPayloadInput): ArrayBuffer {
  const source = new Uint8Array(data);
  const nals = parseAnnexBNalUnits(source);
  if (nals.length === 0) {
    throw new Error("injectSei: source buffer has no Annex-B NAL units");
  }
  const firstVcl = nals.find((nal) => isVclNal(nal.nalType));
  if (!firstVcl) {
    throw new Error("injectSei: no VCL NAL found (type 1 or 5)");
  }
  // Splice point is the start of the first VCL NAL's *start code*.
  const spliceOffset = firstVcl.nalHeaderOffset - firstVcl.startCodeLength;
  const seiNal = buildSeiNal(encodeSeiPayload(payload));
  const out = new Uint8Array(source.length + seiNal.length);
  out.set(source.subarray(0, spliceOffset), 0);
  out.set(seiNal, spliceOffset);
  out.set(source.subarray(spliceOffset), spliceOffset + seiNal.length);
  return out.buffer;
}

export function parseSei(data: ArrayBuffer): SeiPayload | null {
  const source = new Uint8Array(data);
  const nals = parseAnnexBNalUnits(source);
  for (const nal of nals) {
    if (nal.nalType !== 6) continue;
    if (nal.bodyLength < 4) continue;
    // body[0] is the NAL header. body[1..] is the RBSP after EP removal.
    const rbsp = unescapeEmulationPrevention(nal.body.subarray(1));
    if (rbsp.length < 2) continue;
    const payloadType = rbsp[0];
    if (payloadType !== PAYLOAD_TYPE_USER_DATA_UNREGISTERED) continue;
    const payloadSize = rbsp[1];
    if (rbsp.length < 2 + payloadSize) continue;
    const payload = rbsp.subarray(2, 2 + payloadSize);
    const decoded = decodeSeiPayload(payload);
    if (decoded) return decoded;
  }
  return null;
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- features/sei-prototype/sei/h264SeiCodec.test.ts
```

Expected: all sections pass — emulation prevention, NAL parser, payload codec, inject/parse round-trip.

- [ ] **Step 5: Commit**

```bash
git add features/sei-prototype/sei/h264SeiCodec.ts features/sei-prototype/sei/h264SeiCodec.test.ts
git commit -m "feat(sei-prototype): SEI inject and parse round-trip"
```

---

## Task 7: VPW Sampling State Machine (TDD)

**Files:**
- Create: `features/sei-prototype/sei/samplingState.ts`
- Create: `features/sei-prototype/sei/samplingState.test.ts`

- [ ] **Step 1: Write the failing sampling-state tests**

Create `features/sei-prototype/sei/samplingState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSamplingState, stepSampling } from "./samplingState";

describe("sampling state machine", () => {
  it("first frame starts batch 1 and is sampled", () => {
    let state = createSamplingState();
    const decision = stepSampling(state, 1_000_000);
    state = decision.state;
    expect(decision.batchId).toBe(1);
    expect(decision.sample).toBe(true);
    expect(decision.sample && decision.frameId).toBe(1);
    expect(decision.flush).toBe(true); // first frame also seeds nextFlushUs and emits one
  });

  it("emits roughly 32 samples across a 16 s batch with 30 fps input", () => {
    let state = createSamplingState();
    let sampled = 0;
    const ts0 = 0;
    for (let i = 0; i < 16 * 30; i++) {
      const ts = ts0 + Math.round((i * 1_000_000) / 30);
      const decision = stepSampling(state, ts);
      state = decision.state;
      if (decision.sample) sampled++;
    }
    expect(sampled).toBeGreaterThanOrEqual(31);
    expect(sampled).toBeLessThanOrEqual(33);
  });

  it("does not sample after the first 4 s of a batch", () => {
    let state = createSamplingState();
    const ts0 = 5_000_000;
    let lateSamples = 0;
    for (let i = 0; i < 12 * 30; i++) {
      const ts = ts0 + 4_000_000 + Math.round((i * 1_000_000) / 30);
      const decision = stepSampling(state, ts);
      state = decision.state;
      if (decision.sample) lateSamples++;
    }
    expect(lateSamples).toBe(0);
  });

  it("starts a new batch and resets frameId after 16 s of timeline", () => {
    let state = createSamplingState();
    state = stepSampling(state, 0).state;
    const cross = stepSampling(state, 16_000_001);
    state = cross.state;
    expect(cross.batchId).toBe(2);
    expect(cross.sample && cross.frameId).toBe(1);
  });

  it("emits a flush every 4 s of timeline (relative to batch start)", () => {
    let state = createSamplingState();
    let flushes = 0;
    for (let i = 0; i < 16 * 30; i++) {
      const ts = Math.round((i * 1_000_000) / 30);
      const decision = stepSampling(state, ts);
      state = decision.state;
      if (decision.flush) flushes++;
    }
    // First frame seeds nextFlushUs and counts as a flush, then 4 more
    // at ~4s/8s/12s/16s of timeline.
    expect(flushes).toBeGreaterThanOrEqual(4);
    expect(flushes).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- features/sei-prototype/sei/samplingState.test.ts
```

Expected: failure on module resolution.

- [ ] **Step 3: Implement the state machine**

Create `features/sei-prototype/sei/samplingState.ts`:

```ts
export const BATCH_DURATION_US = 16_000_000;
export const SAMPLE_WINDOW_US = 4_000_000;
export const SAMPLE_INTERVAL_US = 125_000;
export const FLUSH_INTERVAL_US = 4_000_000;

export interface SamplingState {
  batchStartUs: number;     // -1 means "not yet started"
  currentBatchId: number;
  frameIdInBatch: number;
  nextSampleUs: number;
  nextFlushUs: number;
}

export function createSamplingState(): SamplingState {
  return {
    batchStartUs: -1,
    currentBatchId: 0,
    frameIdInBatch: 0,
    nextSampleUs: 0,
    nextFlushUs: 0,
  };
}

export type SamplingDecision = {
  state: SamplingState;
  batchId: number;
  flush: boolean;
} & ({ sample: false } | { sample: true; frameId: number });

export function stepSampling(prev: SamplingState, ts: number): SamplingDecision {
  let state: SamplingState = { ...prev };
  let flush = false;

  if (state.batchStartUs < 0 || ts - state.batchStartUs >= BATCH_DURATION_US) {
    state.batchStartUs = ts;
    state.currentBatchId += 1;
    state.frameIdInBatch = 0;
    state.nextSampleUs = ts;
    state.nextFlushUs = ts + FLUSH_INTERVAL_US;
    flush = true;
  } else if (ts >= state.nextFlushUs) {
    flush = true;
    state.nextFlushUs += FLUSH_INTERVAL_US;
  }

  const offsetInBatch = ts - state.batchStartUs;
  const inWindow = offsetInBatch < SAMPLE_WINDOW_US;
  const onTick = ts >= state.nextSampleUs;

  if (inWindow && onTick) {
    state.frameIdInBatch += 1;
    state.nextSampleUs += SAMPLE_INTERVAL_US;
    return {
      state,
      batchId: state.currentBatchId,
      flush,
      sample: true,
      frameId: state.frameIdInBatch,
    };
  }

  return {
    state,
    batchId: state.currentBatchId,
    flush,
    sample: false,
  };
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- features/sei-prototype/sei/samplingState.test.ts
```

Expected: all sampling tests pass.

- [ ] **Step 5: Commit**

```bash
git add features/sei-prototype/sei/samplingState.ts features/sei-prototype/sei/samplingState.test.ts
git commit -m "feat(sei-prototype): sampling state machine"
```

---

## Task 8: H.264 Codec Preference Filter (TDD)

**Files:**
- Create: `features/sei-prototype/pipeline/codecPreference.ts`
- Create: `features/sei-prototype/pipeline/codecPreference.test.ts`

- [ ] **Step 1: Write the failing filter tests**

Create `features/sei-prototype/pipeline/codecPreference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickH264Codecs } from "./codecPreference";

const cap = (mimeType: string): RTCRtpCodec => ({
  mimeType,
  clockRate: 90_000,
  channels: 1,
});

describe("pickH264Codecs", () => {
  it("keeps only H264 codec entries", () => {
    const all = [
      cap("video/VP8"),
      cap("video/H264"),
      cap("video/AV1"),
      cap("video/H264"),
      cap("video/rtx"),
      cap("video/red"),
      cap("video/ulpfec"),
    ];
    const filtered = pickH264Codecs(all);
    expect(filtered.length).toBeGreaterThan(0);
    for (const codec of filtered) {
      expect(["video/H264", "video/rtx", "video/red", "video/ulpfec"]).toContain(codec.mimeType);
    }
    // At minimum one H264 entry must be present.
    expect(filtered.some((c) => c.mimeType === "video/H264")).toBe(true);
  });

  it("returns an empty array when there is no H264", () => {
    const filtered = pickH264Codecs([cap("video/VP8"), cap("video/AV1")]);
    expect(filtered).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

Run:

```bash
npm test -- features/sei-prototype/pipeline/codecPreference.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement the filter**

Create `features/sei-prototype/pipeline/codecPreference.ts`:

```ts
const KEEP_ALONGSIDE_H264 = new Set(["video/rtx", "video/red", "video/ulpfec"]);

export function pickH264Codecs(codecs: RTCRtpCodec[]): RTCRtpCodec[] {
  const hasH264 = codecs.some((c) => c.mimeType.toLowerCase() === "video/h264");
  if (!hasH264) return [];
  return codecs.filter((c) => {
    const mt = c.mimeType.toLowerCase();
    return mt === "video/h264" || KEEP_ALONGSIDE_H264.has(c.mimeType.toLowerCase());
  });
}
```

- [ ] **Step 4: Verify pass**

Run:

```bash
npm test -- features/sei-prototype/pipeline/codecPreference.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add features/sei-prototype/pipeline/codecPreference.ts features/sei-prototype/pipeline/codecPreference.test.ts
git commit -m "feat(sei-prototype): H264 codec preference filter"
```

---

## Task 9: Typed Metadata Channel Wrapper

**Files:**
- Create: `features/sei-prototype/metadata/metadataChannel.ts`

- [ ] **Step 1: Implement the wrapper**

Create `features/sei-prototype/metadata/metadataChannel.ts`:

```ts
import type { FlushSignal, FrameMetadata, MetadataChannelMessage } from "./types";

export interface MetadataSender {
  sendMetadata(meta: Omit<FrameMetadata, "kind">): void;
  sendFlush(): void;
}

export interface MetadataReceiver {
  onMessage(handler: (message: MetadataChannelMessage) => void): void;
  close(): void;
}

export function createMetadataSender(port: MessagePort): MetadataSender {
  return {
    sendMetadata(meta) {
      const message: FrameMetadata = { kind: "metadata", ...meta };
      port.postMessage(message);
    },
    sendFlush() {
      const message: FlushSignal = { kind: "flush" };
      port.postMessage(message);
    },
  };
}

export function createMetadataReceiver(port: MessagePort): MetadataReceiver {
  let handler: ((message: MetadataChannelMessage) => void) | null = null;
  port.onmessage = (event: MessageEvent<MetadataChannelMessage>) => {
    handler?.(event.data);
  };
  port.start?.();
  return {
    onMessage(h) {
      handler = h;
    },
    close() {
      port.onmessage = null;
      port.close();
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/metadata/metadataChannel.ts
git commit -m "feat(sei-prototype): typed metadata MessagePort wrapper"
```

---

## Task 10: Video Processing Worker

**Files:**
- Create: `features/sei-prototype/workers/videoProcessing.worker.ts`

- [ ] **Step 1: Author the worker**

Create `features/sei-prototype/workers/videoProcessing.worker.ts`:

```ts
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
  return new VideoFrame(buffer, {
    format: frame.format ?? undefined,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    timestamp: ts, // invariant: must equal source ts
    layout,
  });
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/workers/videoProcessing.worker.ts
git commit -m "feat(sei-prototype): video processing worker with sampling pipeline"
```

---

## Task 11: Encoded Transform Worker (Sender + Receiver Roles)

**Files:**
- Create: `features/sei-prototype/workers/encodedTransform.worker.ts`

- [ ] **Step 1: Author the worker**

Create `features/sei-prototype/workers/encodedTransform.worker.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/workers/encodedTransform.worker.ts
git commit -m "feat(sei-prototype): encoded transform worker (sender + receiver)"
```

---

## Task 12: Diagnostic Aggregator (tsObservation)

**Files:**
- Create: `features/sei-prototype/logging/tsObservation.ts`

- [ ] **Step 1: Implement the aggregator**

Create `features/sei-prototype/logging/tsObservation.ts`:

```ts
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
    state.framesOut += 1;
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
        state.injected += 1;
      } else {
        row.senderHit = false;
        row.senderSelfParse = null;
      }
    }
    logRaw(entry);
  }

  function ingestRecvEtw(entry: RawLogEntry) {
    const metaTs = entry.payload.metaTs as number | undefined;
    if (metaTs !== undefined) {
      const row = state.rows.get(metaTs);
      if (row) {
        row.recvAtMs = entry.t;
        row.recvEncodedTs = entry.payload.encodedTs as number | undefined;
        row.recvMetaTimestamp = metaTs;
        row.recvMetaRtpTs = entry.payload.metaRtpTs as number | undefined;
        row.recvSEI = entry.payload.parsed as SeiPayload | null;
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
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/logging/tsObservation.ts
git commit -m "feat(sei-prototype): diagnostic aggregator and pass/fail verdict"
```

---

## Task 13: Video Pipeline Controller

**Files:**
- Create: `features/sei-prototype/pipeline/VideoPipelineController.ts`

- [ ] **Step 1: Author the controller**

Create `features/sei-prototype/pipeline/VideoPipelineController.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors. If `processor.readable` / `generator.writable` are flagged because TypeScript's `Transferable` union does not accept generic `ReadableStream<VideoFrame>` in this lib version, fall back to `postMessage(payload, [metadataChannel.port1, processor.readable, generator.writable] as unknown as Transferable[])`.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/pipeline/VideoPipelineController.ts
git commit -m "feat(sei-prototype): pipeline controller wiring PCs and workers"
```

---

## Task 14: SeiPrototypeApp UI

**Files:**
- Modify: `features/sei-prototype/SeiPrototypeApp.tsx`

- [ ] **Step 1: Replace the placeholder with the full UI**

Overwrite `features/sei-prototype/SeiPrototypeApp.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startPipeline, type PipelineHandles } from "./pipeline/VideoPipelineController";
import { createAggregator, type AggregatorState, type Summary } from "./logging/tsObservation";
import type { ExportPayload, SampleRow } from "./metadata/types";

type Phase = "idle" | "starting" | "running" | "stopping" | "error";

interface UiState {
  phase: Phase;
  errorMessage: string | null;
  summary: Summary;
  rows: SampleRow[];
  elapsedSec: number;
  connection: RTCPeerConnectionState;
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

export default function SeiPrototypeApp() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipelineRef = useRef<PipelineHandles | null>(null);
  const aggregatorRef = useRef<ReturnType<typeof createAggregator> | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);

  const [ui, setUi] = useState<UiState>({
    phase: "idle",
    errorMessage: null,
    summary: emptySummary(),
    rows: [],
    elapsedSec: 0,
    connection: "new",
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

  const handleStart = useCallback(async () => {
    if (ui.phase === "running" || ui.phase === "starting") return;
    setUi((prev) => ({ ...prev, phase: "starting", errorMessage: null }));

    const aggregator = createAggregator({
      onUpdate: () => { /* throttled via tick */ },
    });
    aggregatorRef.current = aggregator;
    aggregator.markStart();
    startMsRef.current = Date.now();

    try {
      const handles = await startPipeline({
        onRawLog: (entry) => aggregator.ingest(entry),
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            void remoteVideoRef.current.play().catch(() => {});
          }
        },
        onConnectionState: (state) => setUi((prev) => ({ ...prev, connection: state })),
        onError: (err) => setUi((prev) => ({ ...prev, errorMessage: err.message, phase: "error" })),
      });
      pipelineRef.current = handles;
      aggregator.setEnvSnapshot(handles.envSnapshot);
      aggregator.addStatsSnapshot(await handles.captureStats());

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = handles.localStream;
        void localVideoRef.current.play().catch(() => {});
      }

      statsIntervalRef.current = window.setInterval(async () => {
        const snap = await handles.captureStats();
        aggregator.addStatsSnapshot(snap);
        const decode = extractDecodeStats(snap.pc2);
        aggregator.updateDecodeStats(decode);
      }, 5_000);
      tickIntervalRef.current = window.setInterval(refreshSummary, 500);

      setUi((prev) => ({ ...prev, phase: "running" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUi((prev) => ({ ...prev, phase: "error", errorMessage: message }));
    }
  }, [refreshSummary, ui.phase]);

  const handleStop = useCallback(async () => {
    if (!pipelineRef.current) return;
    setUi((prev) => ({ ...prev, phase: "stopping" }));
    if (statsIntervalRef.current !== null) window.clearInterval(statsIntervalRef.current);
    if (tickIntervalRef.current !== null) window.clearInterval(tickIntervalRef.current);
    statsIntervalRef.current = null;
    tickIntervalRef.current = null;
    try {
      const finalSnap = await pipelineRef.current.captureStats();
      aggregatorRef.current?.addStatsSnapshot(finalSnap);
      await pipelineRef.current.stop();
    } catch {
      /* ignore */
    }
    aggregatorRef.current?.markStop();
    pipelineRef.current = null;
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
    a.download = `sei-prototype-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    return () => {
      if (statsIntervalRef.current !== null) window.clearInterval(statsIntervalRef.current);
      if (tickIntervalRef.current !== null) window.clearInterval(tickIntervalRef.current);
      void pipelineRef.current?.stop();
    };
  }, []);

  return (
    <div className="p-6 text-sm text-[#0f0e1a] dark:text-[#f1f0f6] space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">SEI EncodedTransform Prototype</h1>
          <p className="opacity-70 text-xs">Chrome only · H.264 only · one tab, two PeerConnections.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40"
            disabled={ui.phase === "running" || ui.phase === "starting"}
            onClick={handleStart}
          >Start</button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40"
            disabled={ui.phase !== "running"}
            onClick={handleStop}
          >Stop</button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40"
            disabled={ui.phase === "idle" && ui.summary.framesOut === 0}
            onClick={handleExport}
          >Export JSON</button>
        </div>
      </header>

      {ui.errorMessage && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-700 dark:text-red-300">
          {ui.errorMessage}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <VideoPanel title="Local preview" videoRef={localVideoRef} muted />
        <VideoPanel title="Remote (decoded by pc2)" videoRef={remoteVideoRef} muted={false} />
      </section>

      <SummaryPanel ui={ui} />

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

function SummaryPanel({ ui }: { ui: UiState }) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-white/10 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <Stat label="Phase" value={ui.phase} />
      <Stat label="Connection" value={ui.connection} />
      <Stat label="Elapsed" value={`${ui.elapsedSec} s`} />
      <Stat label="Frames out (gen)" value={`${ui.summary.framesOut} / sampled ${ui.summary.sampled}`} />
      <Stat label="Sender ETW" value={`injected ${ui.summary.injected} · hits ${ui.summary.hits}`} />
      <Stat label="Receiver parsed" value={`${ui.summary.recvParsed}`} />
      <Stat label="Decoder" value={`framesDecoded=${ui.summary.framesDecoded} · freezeCount=${ui.summary.freezeCount}`} />
      <Stat label="Pass/Fail" value={
        `H1 ${ui.summary.passFail.H1} · H2 ${ui.summary.passFail.H2} · H3 ${ui.summary.passFail.H3} · H4 ${ui.summary.passFail.H4}`
      } />
    </section>
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
    return <div className="text-xs opacity-60">No sampled frames yet — start the pipeline to begin.</div>;
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

function extractDecodeStats(pc2Stats: unknown): { framesDecoded: number; freezeCount: number } {
  let framesDecoded = 0;
  let freezeCount = 0;
  if (Array.isArray(pc2Stats)) {
    for (const stat of pc2Stats) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "inbound-rtp" && (stat as { kind?: string }).kind === "video") {
        const s = stat as { framesDecoded?: number; freezeCount?: number };
        framesDecoded = s.framesDecoded ?? framesDecoded;
        freezeCount = s.freezeCount ?? freezeCount;
      }
    }
  }
  return { framesDecoded, freezeCount };
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add features/sei-prototype/SeiPrototypeApp.tsx
git commit -m "feat(sei-prototype): UI with start/stop/export and live summary"
```

---

## Task 15: Manual Verification In Chrome

**Files:**
- (no source changes — manual verification only)

- [ ] **Step 1: Start the dev server**

Run:

```bash
npm run dev
```

Expected: Next.js prints `ready started server on 0.0.0.0:3000`.

- [ ] **Step 2: Open the prototype in Chrome**

Navigate to `http://localhost:3000/test/sei-prototype` in desktop Chrome (latest stable). Allow camera permission.

- [ ] **Step 3: Click Start and watch the first 30 s**

Expected during the first 30 seconds:
- Local preview renders the camera feed within 1 s.
- Remote `<video>` begins rendering within 2-3 s and never freezes.
- Summary panel shows `framesOut` increasing, `sampled` ≈ 2 per second initially.
- `Sender ETW · injected` count tracks `sampled` once metadata propagates.

If the prototype halts with a "Annex-B start code not found" message (from the inject step), record the message and the hex dump from the raw log — this indicates `encodedFrame.data` is not Annex-B in your Chrome build (H2 fails honestly; halt and report).

- [ ] **Step 4: Inspect the per-sample table for the four columns**

Expected:
- `senderMetaTs` equals `vfTs μs` on every sampled row (H1 ✓).
- `hit?` is ✓ on every sampled row after the metadata cache warms (within 1 batch).
- `selfParse` equals `batchId/frameId` of the row (H2 ✓).
- `recvSEI` equals `batchId/frameId` of the row (H4 ✓).

After ≥30 s of continuous remote playback with `freezeCount=0`, H3 also flips to ✓.

- [ ] **Step 5: Read the Pass/Fail row**

Expected: all four hypotheses display ✓.

- [ ] **Step 6: Export the JSON**

Click **Export JSON**. The browser downloads `sei-prototype-<timestamp>.json` and the same payload is copied to the clipboard. Open the file and confirm:
- `summary.passFail` is all `"pass"`.
- `samples` array length matches the table.
- `statsSnapshots` has ≥ 2 entries.

- [ ] **Step 7: Repeat across three independent runs**

Stop, refresh the page, and repeat steps 3-6 two more times. Each run should land at all-pass independently. Record any deviation in the raw log section.

- [ ] **Step 8: No commit — verification only**

This task produces no source changes. Document any anomalies as a follow-up issue rather than amending the prototype.

---

## Self-Review Notes (Author)

- **Spec coverage:** Task 3-6 cover SEI codec + emulation prevention + NAL parsing + inject/parse (H2/H4 byte layer). Task 7 covers the VPW sampling state machine. Task 8 enforces H.264-only (codec preference). Tasks 10-11 implement the two workers per the spec's role section. Task 12 produces the SampleRow aggregator that drives the pass/fail UI (H1/H2/H3/H4 verdict). Task 13 builds the controller including startup-order constraints (setCodecPreferences before createOffer; receiver transform before setRemoteDescription). Task 14 is the UI surface — local/remote video, summary, per-sample table, export. Task 15 is the manual verification workflow with three repeated runs (spec §"Verification workflow").
- **Hard ordering constraints:** Step 13 wires `tx.setCodecPreferences` *before* `createOffer` (matches spec startup step 9 < step 15) and attaches `rx.receiver.transform` *before* `pc2.setRemoteDescription(offer)` (matches spec step 14 < step 15).
- **Out-of-scope respected:** No changes to `features/webrtc-meeting/` or `server/webrtc-signaling/`. No real network conditions, multi-tab signaling, persistence, codec other than H.264, or reconnect logic. SEI payload is fixed 32 bytes (single-byte size field).
- **Risks tracked:** The first-frame hex dump in Task 11 (`sender-etw.first-frame-hex`) implements the Annex-B sanity check described in the spec §"Sanity check on first frame" / §"Risks" row 1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-25-webrtc-sei-encoded-transform-prototype.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per Task with checkpoint review between tasks.
2. **Inline Execution** — execute Tasks in this session using `superpowers:executing-plans`, batched with review checkpoints.
