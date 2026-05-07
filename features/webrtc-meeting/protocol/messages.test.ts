import { describe, expect, it } from "vitest";
import {
  createClientMessageId,
  createJoinRoomMessage,
  isSignalMessage,
  normalizeRoomId,
} from "./messages";

describe("signaling protocol", () => {
  it("normalizes room ids for stable sharing", () => {
    expect(normalizeRoomId("  Demo Room_01  ")).toBe("demo-room-01");
    expect(normalizeRoomId("")).toMatch(/^room-[a-z0-9]{6}$/);
  });

  it("creates valid join-room messages", () => {
    const message = createJoinRoomMessage({
      roomId: "demo-room",
      participantId: "p-1",
      displayName: "Ada",
    });

    expect(message.type).toBe("join-room");
    expect(message.roomId).toBe("demo-room");
    expect(message.displayName).toBe("Ada");
    expect(isSignalMessage(message)).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isSignalMessage({ type: "offer" })).toBe(false);
    expect(isSignalMessage({ roomId: "x", participantId: "p" })).toBe(false);
  });

  it("creates unique message ids", () => {
    expect(createClientMessageId()).not.toBe(createClientMessageId());
  });
});
