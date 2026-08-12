import { describe, expect, it } from "vitest";
import { testPages } from "./testPages";

describe("testPages", () => {
  it("registers the DTLS network diagnosis route", () => {
    expect(testPages).toContainEqual(
      expect.objectContaining({
        id: "dtls-network-diagnosis",
        path: "/test/dtls-network-diagnosis",
        category: "Network",
      }),
    );
  });

  it("registers the NTP capture timestamp route", () => {
    expect(testPages).toContainEqual(
      expect.objectContaining({
        id: "ntp-capture-timestamp",
        description:
          "Calculate NTP timestamps from VideoFrame metadata or timestamp",
        path: "/test/ntp-capture-timestamp",
        category: "Debug",
      }),
    );
  });
});
