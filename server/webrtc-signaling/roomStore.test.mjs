import { describe, expect, it } from "vitest";
import { createRoomStore } from "./roomStore.mjs";

describe("webrtc signaling room store", () => {
  it("assigns caller then answerer and rejects a third participant", () => {
    const store = createRoomStore({ now: () => 1000 });

    const first = store.joinRoom({
      roomId: "room-a",
      participantId: "p1",
      displayName: "One",
      socket: { id: "s1" },
    });
    const second = store.joinRoom({
      roomId: "room-a",
      participantId: "p2",
      displayName: "Two",
      socket: { id: "s2" },
    });
    const third = store.joinRoom({
      roomId: "room-a",
      participantId: "p3",
      displayName: "Three",
      socket: { id: "s3" },
    });

    expect(first.ok).toBe(true);
    expect(first.self.role).toBe("caller");
    expect(second.ok).toBe(true);
    expect(second.self.role).toBe("answerer");
    expect(third.ok).toBe(false);
    expect(third.code).toBe("room-full");
  });

  it("returns the peer socket for routed messages", () => {
    const store = createRoomStore({ now: () => 1000 });
    const socket1 = { id: "s1" };
    const socket2 = { id: "s2" };

    store.joinRoom({ roomId: "room-a", participantId: "p1", displayName: "One", socket: socket1 });
    store.joinRoom({ roomId: "room-a", participantId: "p2", displayName: "Two", socket: socket2 });

    expect(store.getPeerSocket("room-a", "p1")).toBe(socket2);
    expect(store.getPeerSocket("room-a", "p2")).toBe(socket1);
  });

  it("removes empty rooms when participants leave", () => {
    const store = createRoomStore({ now: () => 1000 });
    store.joinRoom({ roomId: "room-a", participantId: "p1", displayName: "One", socket: { id: "s1" } });

    const result = store.leaveRoom("room-a", "p1");

    expect(result.removed).toBe(true);
    expect(store.getRoom("room-a")).toBe(null);
  });
});
