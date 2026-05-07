import { describe, expect, it } from "vitest";
import { createInitialMeetingState, meetingReducer } from "./meetingReducer";

describe("meetingReducer", () => {
  it("moves from idle to waiting after joining a room alone", () => {
    const state = meetingReducer(createInitialMeetingState(), {
      type: "joined-room",
      roomId: "room-a",
      participantId: "p1",
      displayName: "Ada",
      role: "caller",
      peer: null,
    });

    expect(state.lifecycle).toBe("waiting");
    expect(state.roomId).toBe("room-a");
    expect(state.localParticipant?.role).toBe("caller");
  });

  it("tracks peer presence and connected state", () => {
    const initial = createInitialMeetingState();
    const withPeer = meetingReducer(initial, {
      type: "peer-joined",
      peer: { participantId: "p2", displayName: "Ben", role: "answerer", joinedAt: 1 },
    });
    const connected = meetingReducer(withPeer, {
      type: "connection-state-changed",
      peerConnectionState: "connected",
      iceConnectionState: "connected",
    });

    expect(withPeer.remoteParticipant?.displayName).toBe("Ben");
    expect(connected.lifecycle).toBe("connected");
  });
});
