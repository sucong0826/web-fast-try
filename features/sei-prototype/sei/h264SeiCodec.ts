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
