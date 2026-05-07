import { describe, expect, it } from "vitest";
import { DEFAULT_ICE_SERVERS, parseIceServers } from "./ice";

describe("ICE config", () => {
  it("uses default STUN when input is empty", () => {
    expect(parseIceServers("")).toEqual(DEFAULT_ICE_SERVERS);
  });

  it("parses JSON ICE servers", () => {
    expect(parseIceServers('[{"urls":"turn:turn.example.com","username":"u","credential":"p"}]')).toEqual([
      { urls: "turn:turn.example.com", username: "u", credential: "p" },
    ]);
  });

  it("falls back to default STUN for invalid JSON", () => {
    expect(parseIceServers("not json")).toEqual(DEFAULT_ICE_SERVERS);
  });
});
