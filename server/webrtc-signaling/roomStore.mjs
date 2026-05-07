export function createRoomStore({ now = () => Date.now() } = {}) {
  const rooms = new Map();

  function getRoom(roomId) {
    return rooms.get(roomId) || null;
  }

  function snapshot(room, selfParticipantId) {
    const participants = Array.from(room.participants.values()).map(({ socket, ...participant }) => participant);
    const self = participants.find((participant) => participant.participantId === selfParticipantId);
    const peer = participants.find((participant) => participant.participantId !== selfParticipantId) || null;
    return { self, peer, participants };
  }

  function joinRoom({ roomId, participantId, displayName, socket }) {
    const room = rooms.get(roomId) || {
      roomId,
      createdAt: now(),
      participants: new Map(),
    };

    if (!rooms.has(roomId)) {
      rooms.set(roomId, room);
    }

    const existing = room.participants.get(participantId);
    if (existing) {
      room.participants.set(participantId, { ...existing, socket });
      return { ok: true, ...snapshot(room, participantId) };
    }

    if (room.participants.size >= 2) {
      return { ok: false, code: "room-full", message: "This room already has two participants." };
    }

    const role = room.participants.size === 0 ? "caller" : "answerer";
    room.participants.set(participantId, {
      participantId,
      displayName: displayName || "Guest",
      role,
      joinedAt: now(),
      socket,
    });

    return { ok: true, ...snapshot(room, participantId) };
  }

  function leaveRoom(roomId, participantId) {
    const room = rooms.get(roomId);
    if (!room) return { removed: false, peerSocket: null };

    room.participants.delete(participantId);
    const peerEntry = Array.from(room.participants.values())[0] || null;

    if (room.participants.size === 0) {
      rooms.delete(roomId);
      return { removed: true, peerSocket: null };
    }

    return { removed: true, peerSocket: peerEntry.socket };
  }

  function getPeerSocket(roomId, participantId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    const peer = Array.from(room.participants.values()).find(
      (participant) => participant.participantId !== participantId
    );
    return peer?.socket || null;
  }

  function getParticipant(roomId, participantId) {
    const room = rooms.get(roomId);
    return room?.participants.get(participantId) || null;
  }

  return {
    getRoom,
    joinRoom,
    leaveRoom,
    getPeerSocket,
    getParticipant,
  };
}
