import { WebSocketServer } from "ws";
import { createRoomStore } from "./roomStore.mjs";

const port = Number(process.env.WEBRTC_SIGNALING_PORT || 8787);
const roomStore = createRoomStore();
const server = new WebSocketServer({ port });

function createMessage(type, payload) {
  return {
    type,
    messageId: `server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sentAt: Date.now(),
    participantId: "server",
    ...payload,
  };
}

function send(socket, message) {
  if (socket?.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseMessage(raw) {
  try {
    const parsed = JSON.parse(raw.toString());
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.type !== "string" ||
      typeof parsed.roomId !== "string" ||
      typeof parsed.participantId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

server.on("connection", (socket) => {
  socket.context = null;

  socket.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      send(socket, createMessage("error", {
        roomId: "unknown",
        code: "invalid-message",
        message: "Message must be valid signaling JSON.",
      }));
      return;
    }

    if (message.type === "join-room") {
      const joined = roomStore.joinRoom({
        roomId: message.roomId,
        participantId: message.participantId,
        displayName: message.displayName,
        socket,
      });

      if (!joined.ok) {
        send(socket, createMessage("room-full", {
          roomId: message.roomId,
          code: joined.code,
          message: joined.message,
        }));
        return;
      }

      socket.context = {
        roomId: message.roomId,
        participantId: message.participantId,
      };

      send(socket, createMessage("room-snapshot", {
        roomId: message.roomId,
        self: joined.self,
        peer: joined.peer,
        participants: joined.participants,
      }));

      const peerSocket = roomStore.getPeerSocket(message.roomId, message.participantId);
      send(peerSocket, createMessage("peer-joined", {
        roomId: message.roomId,
        peer: joined.self,
      }));
      return;
    }

    const participant = roomStore.getParticipant(message.roomId, message.participantId);
    if (!participant) {
      send(socket, createMessage("error", {
        roomId: message.roomId,
        code: "not-in-room",
        message: "Join the room before sending signaling messages.",
      }));
      return;
    }

    if (message.type === "leave-room") {
      handleLeave(socket);
      return;
    }

    const peerSocket = roomStore.getPeerSocket(message.roomId, message.participantId);
    if (!peerSocket) {
      send(socket, createMessage("error", {
        roomId: message.roomId,
        code: "peer-not-available",
        message: "There is no peer in this room yet.",
      }));
      return;
    }

    send(peerSocket, message);
  });

  socket.on("close", () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const context = socket.context;
  if (!context) return;
  socket.context = null;
  const result = roomStore.leaveRoom(context.roomId, context.participantId);
  send(result.peerSocket, createMessage("peer-left", {
    roomId: context.roomId,
    peerParticipantId: context.participantId,
  }));
}

server.on("listening", () => {
  console.log(`WebRTC signaling server listening on ws://localhost:${port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
