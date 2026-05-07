import { describe, expect, it } from "vitest";
import { createEventLogger } from "./EventLogger";

describe("EventLogger", () => {
  it("keeps newest events within the limit", () => {
    const logger = createEventLogger(2);
    logger.append("signaling", "first");
    logger.append("media", "second");
    logger.append("peer", "third");

    expect(logger.getEvents().map((event) => event.message)).toEqual(["second", "third"]);
  });

  it("formats logs for copying", () => {
    const logger = createEventLogger(10);
    logger.append("signaling", "offer sent", { roomId: "room-a" });

    expect(logger.toText()).toContain("[signaling] offer sent");
    expect(logger.toText()).toContain("room-a");
  });
});
