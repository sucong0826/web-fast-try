import { WebSocketServer } from "ws";
import { createRoomStore } from "./roomStore.mjs";

// Railway injects PORT; WEBRTC_SIGNALING_PORT is used in local dev.
const port = Number(process.env.PORT || process.env.WEBRTC_SIGNALING_PORT || 8787);
const roomStore = createRoomStore();
const server = new WebSocketServer({ port });

// Add Private Network Access header so Safari/Edge allow cross-site WebSocket
// connections to local addresses (required by the PNA spec when Sec-Fetch-Site: cross-site).
server.on("headers", (headers, req) => {
  console.log("[headers] event fired — origin:", req.headers.origin, "Sec-Fetch-Site:", req.headers["sec-fetch-site"]);
  headers.push("Access-Control-Allow-Private-Network: true");
  const origin = req.headers.origin;
  if (origin) headers.push(`Access-Control-Allow-Origin: ${origin}`);
  console.log("[headers] pushed response headers:", headers.slice(-2));
});

server.on("error", (err) => {
  console.error("[server error]", err);
});

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
  if (socket && socket.readyState === socket.OPEN) {
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

function pid(id) { return id ? id.slice(0, 8) : "(null)"; }

function logRoomState(label, roomId) {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    console.log(`  [room] ${label}: room "${roomId}" — NOT FOUND`);
    return;
  }
  const members = Array.from(room.participants.values())
    .map((p) => `${pid(p.participantId)}(${p.role})`);
  console.log(`  [room] ${label}: room "${roomId}" — [${members.join(", ")}]`);
}

server.on("connection", (socket, req) => {
  console.log(`[ws] connected — origin: ${req.headers.origin} ip: ${req.socket.remoteAddress}`);
  socket.context = null;

  socket.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      console.log(`[msg] unparseable message from unknown`);
      send(socket, createMessage("error", {
        roomId: "unknown",
        code: "invalid-message",
        message: "Message must be valid signaling JSON.",
      }));
      return;
    }

    console.log(`[msg] type="${message.type}" from="${pid(message.participantId)}" room="${message.roomId}"`);

    if (message.type === "join-room") {
      const joined = roomStore.joinRoom({
        roomId: message.roomId,
        participantId: message.participantId,
        displayName: message.displayName,
        socket,
      });

      if (!joined.ok) {
        console.log(`[join] REJECTED "${pid(message.participantId)}" — ${joined.code}`);
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

      console.log(`[join] OK "${pid(message.participantId)}" as ${joined.self.role}`);
      logRoomState("after join", message.roomId);

      send(socket, createMessage("room-snapshot", {
        roomId: message.roomId,
        self: joined.self,
        peer: joined.peer,
        participants: joined.participants,
      }));
      console.log(`[send] room-snapshot → ${pid(message.participantId)}`);

      const peerSocket = roomStore.getPeerSocket(message.roomId, message.participantId);
      if (peerSocket) {
        send(peerSocket, createMessage("peer-joined", {
          roomId: message.roomId,
          peer: joined.self,
        }));
        console.log(`[send] peer-joined → peer of ${pid(message.participantId)}`);
      }
      return;
    }

    const participant = roomStore.getParticipant(message.roomId, message.participantId);
    if (!participant) {
      console.log(`[ERR] not-in-room: type="${message.type}" from="${pid(message.participantId)}"`);
      logRoomState("at not-in-room", message.roomId);
      send(socket, createMessage("error", {
        roomId: message.roomId,
        code: "not-in-room",
        message: "Join the room before sending signaling messages.",
      }));
      return;
    }

    if (message.type === "leave-room") {
      console.log(`[leave] "${pid(message.participantId)}" leaving "${message.roomId}"`);
      handleLeave(socket);
      return;
    }

    const peerSocket = roomStore.getPeerSocket(message.roomId, message.participantId);
    if (!peerSocket) {
      console.log(`[fwd] no peer for type="${message.type}" from="${pid(message.participantId)}" — dropping`);
      send(socket, createMessage("error", {
        roomId: message.roomId,
        code: "peer-not-available",
        message: "There is no peer in this room yet.",
      }));
      return;
    }

    console.log(`[fwd] type="${message.type}" ${pid(message.participantId)} → peer`);
    send(peerSocket, message);
  });

  socket.on("close", () => {
    if (socket.context) {
      console.log(`[ws] closed — "${pid(socket.context.participantId)}" in room "${socket.context.roomId}"`);
    } else {
      console.log(`[ws] closed — unauthenticated socket`);
    }
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
