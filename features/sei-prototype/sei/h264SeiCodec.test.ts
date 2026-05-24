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
