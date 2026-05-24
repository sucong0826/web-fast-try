import { SEI_PAYLOAD_BYTES, SEI_UUID_BYTES, type SeiPayload } from "@/features/sei-prototype/metadata/types";

// Note: the trailing-pad emit below is one-way. If a caller passes arbitrary
// bytes ending in 0x00 0x00, the appended 0x03 has no follower byte for
// unescape's lookahead guard to drop, so unescape(escape(x)) may differ from x.
// SEI RBSP always ends in 0x80 (rbsp_trailing_bits), so this is unreachable here.
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
