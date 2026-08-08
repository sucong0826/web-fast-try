import { describe, expect, it } from "vitest";
import {
  findNearestNtpTimestamp,
  ntpTimestampToParts,
  parseNtpTimestampList,
  unixEpochUsToNtpTimestamp,
} from "./ntp-timestamp";

describe("NTP timestamp utilities", () => {
  it("encodes Unix microseconds as a decimal Q32.32 NTP timestamp", () => {
    expect(unixEpochUsToNtpTimestamp(1779794971275150)).toBe(
      "17131695848442313467",
    );
  });

  it("preserves NTP seconds and fraction as decimal strings", () => {
    expect(ntpTimestampToParts("17131695848442313467")).toEqual({
      seconds: "3988783771",
      fraction: "1181760251",
    });
  });

  it("selects the nearest server timestamp and applies tolerance", () => {
    expect(
      findNearestNtpTimestamp(
        ["17131695848442313467", "17131695848446608434"],
        "17131695848442313467",
        20,
      ),
    ).toEqual({ index: 0, diffMs: 0, matched: true });
  });

  it("marks a nearest server value outside a narrow tolerance", () => {
    expect(
      findNearestNtpTimestamp(
        ["17131695848450903401"],
        "17131695848442313467",
        1,
      ),
    ).toEqual({ index: 0, diffMs: 2, matched: false });
  });

  it("extracts decimal NTP values from multiline input", () => {
    expect(
      parseNtpTimestampList("frame: 17131695848442313467\nignored"),
    ).toEqual(["17131695848442313467"]);
  });

  it("rejects negative Unix timestamps to avoid invalid NTP encoding", () => {
    expect(() => unixEpochUsToNtpTimestamp(-1)).toThrow(RangeError);
  });
});
