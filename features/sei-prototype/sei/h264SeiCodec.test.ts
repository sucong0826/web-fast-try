import { describe, expect, it } from "vitest";
import {
  escapeEmulationPrevention,
  parseAnnexBNalUnits,
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

  it("unescape is the inverse of escape for SEI-shaped byte strings (rbsp_trailing_bit at end)", () => {
    const samples: Uint8Array[] = [
      u(),
      u(0xff),
      u(0x00, 0x00, 0x01, 0x02, 0x03),
      u(0x00, 0x00, 0x00, 0x00, 0x00),
      u(0xde, 0xad, 0xbe, 0xef),
      u(0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00, 0x00, 0x04),
      u(0x06, 0x05, 0x20, 0x00, 0x00, 0x01, 0x02, 0x80),
    ];
    for (const sample of samples) {
      const round = unescapeEmulationPrevention(
        escapeEmulationPrevention(sample),
      );
      expect(Array.from(round)).toEqual(Array.from(sample));
    }
  });
});

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
