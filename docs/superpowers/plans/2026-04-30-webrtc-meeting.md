# WebRTC Meeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure WebRTC two-person meeting app in WebFastTry with a local/deployable WebSocket signaling server, audio/video/screen share, chat, device selection, stats, and diagnostics.

**Architecture:** Add an independent `features/webrtc-meeting` module loaded by `/test/webrtc-meeting`, with separate engines for signaling, local media, peer connection, stats, logging, and React state. Add a standalone Node WebSocket signaling server under `server/webrtc-signaling` and keep it media-blind. Phase 1 sends raw browser tracks and keeps the peer sender API ready for a later media routing layer.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, lucide-react, WebRTC browser APIs, `ws` for the signaling server, Vitest for focused unit tests.

---

## File Structure

- Modify `package.json`: add scripts for tests and signaling server; add `ws`, `vitest`, and `@types/ws`.
- Modify `config/testPages.ts`: add WebRTC Meeting test card.
- Modify `app/page.tsx`: add a `Users` icon mapping for the new card.
- Create `app/test/webrtc-meeting/page.tsx`: client-only dynamic entry.
- Create `features/webrtc-meeting/EmbeddedApp.tsx`: provider and main feature shell.
- Create `features/webrtc-meeting/types.ts`: shared feature types for state, media, stats, and UI.
- Create `features/webrtc-meeting/protocol/messages.ts`: signaling protocol types, message constructors, and validators.
- Create `features/webrtc-meeting/protocol/messages.test.ts`: protocol validation tests.
- Create `features/webrtc-meeting/config/ice.ts`: ICE server parsing and defaults.
- Create `features/webrtc-meeting/config/ice.test.ts`: ICE parser tests.
- Create `features/webrtc-meeting/logging/EventLogger.ts`: bounded structured event log.
- Create `features/webrtc-meeting/logging/EventLogger.test.ts`: logger tests.
- Create `features/webrtc-meeting/store/meetingReducer.ts`: feature reducer and action helpers.
- Create `features/webrtc-meeting/store/MeetingProvider.tsx`: context provider and typed hooks.
- Create `features/webrtc-meeting/store/meetingReducer.test.ts`: reducer transition tests.
- Create `features/webrtc-meeting/signaling/SignalingClient.ts`: browser WebSocket wrapper.
- Create `features/webrtc-meeting/media/LocalMediaController.ts`: getUserMedia/getDisplayMedia/device handling.
- Create `features/webrtc-meeting/media/mediaStreams.ts`: helpers for building and clearing `MediaStream` objects.
- Create `features/webrtc-meeting/peer/PeerConnectionEngine.ts`: `RTCPeerConnection`, transceivers, perfect negotiation, data channel, and sender replacement.
- Create `features/webrtc-meeting/peer/PeerConnectionEngine.test.ts`: fake-driven negotiation tests.
- Create `features/webrtc-meeting/stats/StatsCollector.ts`: getStats polling and normalization.
- Create `features/webrtc-meeting/stats/StatsCollector.test.ts`: stats normalization tests.
- Create `features/webrtc-meeting/hooks/useMeetingController.ts`: high-level lifecycle controller hook.
- Create `features/webrtc-meeting/components/JoinScreen.tsx`: room/name/signaling/ICE entry UI.
- Create `features/webrtc-meeting/components/MeetingShell.tsx`: meeting workspace layout.
- Create `features/webrtc-meeting/components/StatusBar.tsx`: top connection/status strip.
- Create `features/webrtc-meeting/components/VideoStage.tsx`: local/remote camera and screen-share layout.
- Create `features/webrtc-meeting/components/MediaTile.tsx`: reusable video/audio tile.
- Create `features/webrtc-meeting/components/ControlBar.tsx`: mic/camera/share/devices/record/leave controls.
- Create `features/webrtc-meeting/components/SidePanel.tsx`: Chat, Stats, and Logs tabs.
- Create `features/webrtc-meeting/components/DeviceMenu.tsx`: camera/mic selectors.
- Create `features/webrtc-meeting/components/EmptyState.tsx`: waiting and error states.
- Create `features/webrtc-meeting/styles.module.css`: dense, simple, spacious meeting styling.
- Create `server/webrtc-signaling/roomStore.mjs`: room state and routing logic.
- Create `server/webrtc-signaling/roomStore.test.mjs`: room capacity and routing tests.
- Create `server/webrtc-signaling/server.mjs`: WebSocket server entry.
- Create `scripts/dev-webrtc.mjs`: starts Next.js and signaling server together for local testing.

## Task 1: Tooling, Scripts, And Test Harness

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```bash
npm install ws
npm install -D @types/ws vitest
```

Expected: `package.json` includes `ws` in `dependencies`, `@types/ws` and `vitest` in `devDependencies`, and npm completes without peer dependency errors.

- [ ] **Step 2: Add scripts**

Update `package.json` scripts to include these exact entries while preserving existing scripts:

```json
{
  "dev": "NODE_OPTIONS='--max-old-space-size=4096' next dev",
  "dev:webrtc": "node scripts/dev-webrtc.mjs",
  "signaling:webrtc": "node server/webrtc-signaling/server.mjs",
  "test": "vitest run",
  "test:watch": "vitest",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "analyze:bench": "node scripts/analyze-bench-logs.mjs"
}
```

- [ ] **Step 3: Run dependency-aware script check**

Run:

```bash
npm run test -- --passWithNoTests
```

Expected: Vitest starts and exits successfully because no tests exist yet.

- [ ] **Step 4: Commit tooling**

```bash
git add package.json
git commit -m "chore: add webrtc meeting tooling"
```

## Task 2: Signaling Protocol Types

**Files:**
- Create: `features/webrtc-meeting/protocol/messages.ts`
- Create: `features/webrtc-meeting/protocol/messages.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Create `features/webrtc-meeting/protocol/messages.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test -- features/webrtc-meeting/protocol/messages.test.ts
```

Expected: FAIL because `messages.ts` does not exist.

- [ ] **Step 3: Implement protocol module**

Create `features/webrtc-meeting/protocol/messages.ts`:

```ts
export type ParticipantRole = "caller" | "answerer";

export type SignalMessageType =
  | "join-room"
  | "room-snapshot"
  | "peer-joined"
  | "peer-left"
  | "room-full"
  | "offer"
  | "answer"
  | "ice-candidate"
  | "renegotiate-needed"
  | "media-state"
  | "chat-message"
  | "stats-ping"
  | "error"
  | "leave-room";

export interface BaseSignalMessage {
  type: SignalMessageType;
  roomId: string;
  participantId: string;
  messageId: string;
  sentAt: number;
}

export interface JoinRoomMessage extends BaseSignalMessage {
  type: "join-room";
  displayName: string;
}

export interface RoomParticipant {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: number;
}

export interface RoomSnapshotMessage extends BaseSignalMessage {
  type: "room-snapshot";
  self: RoomParticipant;
  peer: RoomParticipant | null;
  participants: RoomParticipant[];
}

export interface PeerJoinedMessage extends BaseSignalMessage {
  type: "peer-joined";
  peer: RoomParticipant;
}

export interface PeerLeftMessage extends BaseSignalMessage {
  type: "peer-left";
  peerParticipantId: string;
}

export interface SessionDescriptionSignalMessage extends BaseSignalMessage {
  type: "offer" | "answer";
  description: RTCSessionDescriptionInit;
}

export interface IceCandidateSignalMessage extends BaseSignalMessage {
  type: "ice-candidate";
  candidate: RTCIceCandidateInit;
}

export interface RenegotiateNeededMessage extends BaseSignalMessage {
  type: "renegotiate-needed";
  reason: "media" | "ice-restart" | "manual";
}

export interface MediaStateMessage extends BaseSignalMessage {
  type: "media-state";
  media: {
    micOn: boolean;
    cameraOn: boolean;
    screenSharing: boolean;
  };
}

export interface ChatMessage extends BaseSignalMessage {
  type: "chat-message";
  chat: {
    chatId: string;
    displayName: string;
    body: string;
  };
}

export interface StatsPingMessage extends BaseSignalMessage {
  type: "stats-ping";
}

export interface ErrorSignalMessage extends BaseSignalMessage {
  type: "error" | "room-full";
  code: string;
  message: string;
}

export interface LeaveRoomMessage extends BaseSignalMessage {
  type: "leave-room";
}

export type SignalMessage =
  | JoinRoomMessage
  | RoomSnapshotMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | SessionDescriptionSignalMessage
  | IceCandidateSignalMessage
  | RenegotiateNeededMessage
  | MediaStateMessage
  | ChatMessage
  | StatsPingMessage
  | ErrorSignalMessage
  | LeaveRoomMessage;

export function createClientMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createParticipantId(): string {
  return `p-${crypto.randomUUID()}`;
}

export function normalizeRoomId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  if (normalized) return normalized;
  return `room-${Math.random().toString(36).slice(2, 8)}`;
}

export function createJoinRoomMessage(input: {
  roomId: string;
  participantId: string;
  displayName: string;
}): JoinRoomMessage {
  return {
    type: "join-room",
    roomId: normalizeRoomId(input.roomId),
    participantId: input.participantId,
    displayName: input.displayName.trim() || "Guest",
    messageId: createClientMessageId(),
    sentAt: Date.now(),
  };
}

export function isSignalMessage(value: unknown): value is SignalMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.roomId === "string" &&
    typeof candidate.participantId === "string" &&
    typeof candidate.messageId === "string" &&
    typeof candidate.sentAt === "number"
  );
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm run test -- features/webrtc-meeting/protocol/messages.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit protocol**

```bash
git add features/webrtc-meeting/protocol/messages.ts features/webrtc-meeting/protocol/messages.test.ts
git commit -m "feat: define webrtc signaling protocol"
```

## Task 3: Signaling Server Room Store

**Files:**
- Create: `server/webrtc-signaling/roomStore.mjs`
- Create: `server/webrtc-signaling/roomStore.test.mjs`

- [ ] **Step 1: Write failing room store tests**

Create `server/webrtc-signaling/roomStore.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test -- server/webrtc-signaling/roomStore.test.mjs
```

Expected: FAIL because `roomStore.mjs` does not exist.

- [ ] **Step 3: Implement room store**

Create `server/webrtc-signaling/roomStore.mjs`:

```js
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
```

- [ ] **Step 4: Run room store tests**

Run:

```bash
npm run test -- server/webrtc-signaling/roomStore.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit room store**

```bash
git add server/webrtc-signaling/roomStore.mjs server/webrtc-signaling/roomStore.test.mjs
git commit -m "feat: add webrtc signaling room store"
```

## Task 4: WebSocket Signaling Server

**Files:**
- Create: `server/webrtc-signaling/server.mjs`
- Create: `scripts/dev-webrtc.mjs`

- [ ] **Step 1: Create signaling server**

Create `server/webrtc-signaling/server.mjs`:

```js
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
```

- [ ] **Step 2: Create combined dev runner**

Create `scripts/dev-webrtc.mjs`:

```js
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  NEXT_PUBLIC_SIGNALING_URL:
    process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:8787",
  WEBRTC_SIGNALING_PORT: process.env.WEBRTC_SIGNALING_PORT || "8787",
};

const children = [
  spawn("npm", ["run", "signaling:webrtc"], { stdio: "inherit", env }),
  spawn("npm", ["run", "dev"], { stdio: "inherit", env }),
];

function stopAll(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
});

process.on("SIGTERM", () => {
  stopAll("SIGTERM");
});
```

- [ ] **Step 3: Start signaling server smoke test**

Run:

```bash
npm run signaling:webrtc
```

Expected: command prints `WebRTC signaling server listening on ws://localhost:8787`. Stop it with `Ctrl+C`.

- [ ] **Step 4: Commit server**

```bash
git add server/webrtc-signaling/server.mjs scripts/dev-webrtc.mjs package.json
git commit -m "feat: add webrtc signaling server"
```

## Task 5: ICE Config And Event Logger

**Files:**
- Create: `features/webrtc-meeting/config/ice.ts`
- Create: `features/webrtc-meeting/config/ice.test.ts`
- Create: `features/webrtc-meeting/logging/EventLogger.ts`
- Create: `features/webrtc-meeting/logging/EventLogger.test.ts`

- [ ] **Step 1: Write failing config and logger tests**

Create `features/webrtc-meeting/config/ice.test.ts`:

```ts
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
```

Create `features/webrtc-meeting/logging/EventLogger.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test -- features/webrtc-meeting/config/ice.test.ts features/webrtc-meeting/logging/EventLogger.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 3: Implement ICE config**

Create `features/webrtc-meeting/config/ice.ts`:

```ts
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function parseIceServers(input?: string | null): RTCIceServer[] {
  if (!input?.trim()) return DEFAULT_ICE_SERVERS;

  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return DEFAULT_ICE_SERVERS;
    const servers = parsed.filter(
      (server): server is RTCIceServer =>
        !!server &&
        typeof server === "object" &&
        ("urls" in server) &&
        (typeof server.urls === "string" || Array.isArray(server.urls))
    );
    return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

export function getInitialIceServers(): RTCIceServer[] {
  return parseIceServers(process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS);
}
```

- [ ] **Step 4: Implement event logger**

Create `features/webrtc-meeting/logging/EventLogger.ts`:

```ts
export type MeetingLogKind = "signaling" | "peer" | "media" | "stats" | "ui" | "error";

export interface MeetingLogEvent {
  id: string;
  kind: MeetingLogKind;
  message: string;
  data?: unknown;
  createdAt: number;
}

export function createEventLogger(limit = 300) {
  let events: MeetingLogEvent[] = [];

  function append(kind: MeetingLogKind, message: string, data?: unknown): MeetingLogEvent {
    const event: MeetingLogEvent = {
      id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      message,
      data,
      createdAt: Date.now(),
    };
    events = [...events, event].slice(-limit);
    return event;
  }

  function getEvents(): MeetingLogEvent[] {
    return events;
  }

  function clear(): void {
    events = [];
  }

  function toText(): string {
    return events
      .map((event) => {
        const data = event.data === undefined ? "" : ` ${JSON.stringify(event.data)}`;
        return `${new Date(event.createdAt).toISOString()} [${event.kind}] ${event.message}${data}`;
      })
      .join("\n");
  }

  return { append, getEvents, clear, toText };
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test -- features/webrtc-meeting/config/ice.test.ts features/webrtc-meeting/logging/EventLogger.test.ts
```

Expected: PASS.

Commit:

```bash
git add features/webrtc-meeting/config features/webrtc-meeting/logging
git commit -m "feat: add webrtc meeting config and logging"
```

## Task 6: Meeting State Reducer

**Files:**
- Create: `features/webrtc-meeting/types.ts`
- Create: `features/webrtc-meeting/store/meetingReducer.ts`
- Create: `features/webrtc-meeting/store/meetingReducer.test.ts`
- Create: `features/webrtc-meeting/store/MeetingProvider.tsx`

- [ ] **Step 1: Write reducer tests**

Create `features/webrtc-meeting/store/meetingReducer.test.ts`:

```ts
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
```

- [ ] **Step 2: Run reducer tests and verify failure**

Run:

```bash
npm run test -- features/webrtc-meeting/store/meetingReducer.test.ts
```

Expected: FAIL because reducer files do not exist.

- [ ] **Step 3: Create shared feature types**

Create `features/webrtc-meeting/types.ts`:

```ts
import type { MeetingLogEvent } from "./logging/EventLogger";
import type { ParticipantRole, RoomParticipant } from "./protocol/messages";

export type MeetingLifecycle =
  | "idle"
  | "joining"
  | "waiting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "left";

export interface LocalMediaState {
  micOn: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  selectedCameraId: string;
  selectedMicrophoneId: string;
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  permissionError: string;
}

export interface RemoteMediaState {
  micOn: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
}

export interface ChatEntry {
  id: string;
  participantId: string;
  displayName: string;
  body: string;
  createdAt: number;
  delivery: "sending" | "sent" | "received" | "failed";
}

export interface MeetingStatsSnapshot {
  bitrateKbps: number;
  packetsLost: number;
  roundTripTimeMs: number;
  framesPerSecond: number;
  width: number;
  height: number;
  candidatePair: string;
}

export interface MeetingState {
  lifecycle: MeetingLifecycle;
  roomId: string;
  participantId: string;
  displayName: string;
  localParticipant: (RoomParticipant & { role: ParticipantRole }) | null;
  remoteParticipant: RoomParticipant | null;
  websocketState: "idle" | "connecting" | "open" | "closed" | "error";
  peerConnectionState: RTCPeerConnectionState | "new";
  iceConnectionState: RTCIceConnectionState | "new";
  localMedia: LocalMediaState;
  remoteMedia: RemoteMediaState;
  chat: ChatEntry[];
  logs: MeetingLogEvent[];
  stats: MeetingStatsSnapshot | null;
  error: string;
}
```

- [ ] **Step 4: Implement reducer**

Create `features/webrtc-meeting/store/meetingReducer.ts`:

```ts
import type { ChatEntry, MeetingState, MeetingStatsSnapshot, RemoteMediaState } from "../types";
import type { MeetingLogEvent } from "../logging/EventLogger";
import type { ParticipantRole, RoomParticipant } from "../protocol/messages";

export type MeetingAction =
  | { type: "set-joining"; roomId: string; participantId: string; displayName: string }
  | {
      type: "joined-room";
      roomId: string;
      participantId: string;
      displayName: string;
      role: ParticipantRole;
      peer: RoomParticipant | null;
    }
  | { type: "peer-joined"; peer: RoomParticipant }
  | { type: "peer-left"; peerParticipantId: string }
  | {
      type: "connection-state-changed";
      peerConnectionState: RTCPeerConnectionState | "new";
      iceConnectionState: RTCIceConnectionState | "new";
    }
  | { type: "websocket-state"; websocketState: MeetingState["websocketState"] }
  | { type: "local-media"; media: Partial<MeetingState["localMedia"]> }
  | { type: "remote-media"; media: Partial<RemoteMediaState> }
  | { type: "chat-added"; entry: ChatEntry }
  | { type: "logs-updated"; logs: MeetingLogEvent[] }
  | { type: "stats-updated"; stats: MeetingStatsSnapshot | null }
  | { type: "error"; error: string }
  | { type: "left" };

export function createInitialMeetingState(): MeetingState {
  return {
    lifecycle: "idle",
    roomId: "",
    participantId: "",
    displayName: "",
    localParticipant: null,
    remoteParticipant: null,
    websocketState: "idle",
    peerConnectionState: "new",
    iceConnectionState: "new",
    localMedia: {
      micOn: false,
      cameraOn: false,
      screenSharing: false,
      selectedCameraId: "",
      selectedMicrophoneId: "",
      cameras: [],
      microphones: [],
      permissionError: "",
    },
    remoteMedia: {
      micOn: false,
      cameraOn: false,
      screenSharing: false,
    },
    chat: [],
    logs: [],
    stats: null,
    error: "",
  };
}

export function meetingReducer(state: MeetingState, action: MeetingAction): MeetingState {
  switch (action.type) {
    case "set-joining":
      return {
        ...state,
        lifecycle: "joining",
        roomId: action.roomId,
        participantId: action.participantId,
        displayName: action.displayName,
        error: "",
      };
    case "joined-room":
      return {
        ...state,
        lifecycle: action.peer ? "connecting" : "waiting",
        roomId: action.roomId,
        participantId: action.participantId,
        displayName: action.displayName,
        localParticipant: {
          participantId: action.participantId,
          displayName: action.displayName,
          role: action.role,
          joinedAt: Date.now(),
        },
        remoteParticipant: action.peer,
      };
    case "peer-joined":
      return { ...state, lifecycle: "connecting", remoteParticipant: action.peer };
    case "peer-left":
      return {
        ...state,
        lifecycle: "waiting",
        remoteParticipant: null,
        remoteMedia: { micOn: false, cameraOn: false, screenSharing: false },
        peerConnectionState: "new",
        iceConnectionState: "new",
      };
    case "connection-state-changed":
      return {
        ...state,
        peerConnectionState: action.peerConnectionState,
        iceConnectionState: action.iceConnectionState,
        lifecycle:
          action.peerConnectionState === "connected" || action.iceConnectionState === "connected"
            ? "connected"
            : action.peerConnectionState === "failed" || action.iceConnectionState === "failed"
              ? "failed"
              : state.lifecycle,
      };
    case "websocket-state":
      return { ...state, websocketState: action.websocketState };
    case "local-media":
      return { ...state, localMedia: { ...state.localMedia, ...action.media } };
    case "remote-media":
      return { ...state, remoteMedia: { ...state.remoteMedia, ...action.media } };
    case "chat-added":
      return { ...state, chat: [...state.chat, action.entry] };
    case "logs-updated":
      return { ...state, logs: action.logs };
    case "stats-updated":
      return { ...state, stats: action.stats };
    case "error":
      return { ...state, error: action.error, lifecycle: "failed" };
    case "left":
      return { ...createInitialMeetingState(), lifecycle: "left" };
    default:
      return state;
  }
}
```

- [ ] **Step 5: Create provider**

Create `features/webrtc-meeting/store/MeetingProvider.tsx`:

```tsx
"use client";

import React, { createContext, useContext, useMemo, useReducer } from "react";
import { createInitialMeetingState, meetingReducer } from "./meetingReducer";
import type { MeetingAction } from "./meetingReducer";
import type { MeetingState } from "../types";

const MeetingStateContext = createContext<MeetingState | null>(null);
const MeetingDispatchContext = createContext<React.Dispatch<MeetingAction> | null>(null);

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(meetingReducer, undefined, createInitialMeetingState);
  const stableState = useMemo(() => state, [state]);

  return (
    <MeetingStateContext.Provider value={stableState}>
      <MeetingDispatchContext.Provider value={dispatch}>
        {children}
      </MeetingDispatchContext.Provider>
    </MeetingStateContext.Provider>
  );
}

export function useMeetingState(): MeetingState {
  const state = useContext(MeetingStateContext);
  if (!state) throw new Error("useMeetingState must be used within MeetingProvider");
  return state;
}

export function useMeetingDispatch(): React.Dispatch<MeetingAction> {
  const dispatch = useContext(MeetingDispatchContext);
  if (!dispatch) throw new Error("useMeetingDispatch must be used within MeetingProvider");
  return dispatch;
}
```

- [ ] **Step 6: Run reducer tests and commit**

Run:

```bash
npm run test -- features/webrtc-meeting/store/meetingReducer.test.ts
```

Expected: PASS.

Commit:

```bash
git add features/webrtc-meeting/types.ts features/webrtc-meeting/store
git commit -m "feat: add webrtc meeting state"
```

## Task 7: Browser Signaling Client

**Files:**
- Create: `features/webrtc-meeting/signaling/SignalingClient.ts`

- [ ] **Step 1: Implement browser signaling client**

Create `features/webrtc-meeting/signaling/SignalingClient.ts`:

```ts
import type { JoinRoomMessage, SignalMessage } from "../protocol/messages";
import { isSignalMessage } from "../protocol/messages";

export interface SignalingClientOptions {
  url: string;
  onMessage: (message: SignalMessage) => void;
  onStateChange: (state: "connecting" | "open" | "closed" | "error") => void;
  onError: (message: string) => void;
}

export class SignalingClient {
  private socket: WebSocket | null = null;

  constructor(private readonly options: SignalingClientOptions) {}

  connect(): Promise<void> {
    this.options.onStateChange("connecting");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.url);
      this.socket = socket;

      socket.onopen = () => {
        this.options.onStateChange("open");
        resolve();
      };

      socket.onerror = () => {
        this.options.onStateChange("error");
        this.options.onError("Unable to connect to signaling server.");
        reject(new Error("Unable to connect to signaling server."));
      };

      socket.onclose = () => {
        this.options.onStateChange("closed");
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (isSignalMessage(parsed)) {
            this.options.onMessage(parsed);
          } else {
            this.options.onError("Received invalid signaling message.");
          }
        } catch {
          this.options.onError("Received malformed signaling JSON.");
        }
      };
    });
  }

  join(message: JoinRoomMessage): void {
    this.send(message);
  }

  send(message: SignalMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling socket is not open.");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
```

- [ ] **Step 2: Run typecheck through build**

Run:

```bash
npm run build
```

Expected: build may fail because the feature route is not wired yet; TypeScript should not complain about `SignalingClient.ts` syntax. If build reports unrelated existing application errors, record them and continue with feature-local tests in later tasks.

- [ ] **Step 3: Commit signaling client**

```bash
git add features/webrtc-meeting/signaling/SignalingClient.ts
git commit -m "feat: add browser signaling client"
```

## Task 8: Local Media Controller

**Files:**
- Create: `features/webrtc-meeting/media/LocalMediaController.ts`
- Create: `features/webrtc-meeting/media/mediaStreams.ts`

- [ ] **Step 1: Implement media stream helpers**

Create `features/webrtc-meeting/media/mediaStreams.ts`:

```ts
export function createStreamFromTrack(track: MediaStreamTrack | null): MediaStream {
  const stream = new MediaStream();
  if (track) stream.addTrack(track);
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
```

- [ ] **Step 2: Implement local media controller**

Create `features/webrtc-meeting/media/LocalMediaController.ts`:

```ts
export interface LocalMediaSnapshot {
  microphoneTrack: MediaStreamTrack | null;
  cameraTrack: MediaStreamTrack | null;
  screenTrack: MediaStreamTrack | null;
}

export class LocalMediaController {
  private microphoneTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;

  async enumerateDevices(): Promise<{
    cameras: MediaDeviceInfo[];
    microphones: MediaDeviceInfo[];
  }> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: devices.filter((device) => device.kind === "videoinput"),
      microphones: devices.filter((device) => device.kind === "audioinput"),
    };
  }

  async startMicrophone(deviceId?: string): Promise<MediaStreamTrack> {
    this.microphoneTrack?.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const track = stream.getAudioTracks()[0] || null;
    if (!track) throw new Error("No microphone track was created.");
    this.microphoneTrack = track;
    return track;
  }

  async startCamera(deviceId?: string): Promise<MediaStreamTrack> {
    this.cameraTrack?.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    const track = stream.getVideoTracks()[0] || null;
    if (!track) throw new Error("No camera track was created.");
    this.cameraTrack = track;
    return track;
  }

  async startScreenShare(onEnded: () => void): Promise<MediaStreamTrack> {
    this.screenTrack?.stop();
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error("Screen sharing is not supported in this browser.");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const track = stream.getVideoTracks()[0] || null;
    if (!track) throw new Error("No screen-share track was created.");
    track.addEventListener("ended", onEnded, { once: true });
    this.screenTrack = track;
    return track;
  }

  setMicrophoneEnabled(enabled: boolean): void {
    if (this.microphoneTrack) this.microphoneTrack.enabled = enabled;
  }

  setCameraEnabled(enabled: boolean): void {
    if (this.cameraTrack) this.cameraTrack.enabled = enabled;
  }

  stopScreenShare(): void {
    this.screenTrack?.stop();
    this.screenTrack = null;
  }

  getSnapshot(): LocalMediaSnapshot {
    return {
      microphoneTrack: this.microphoneTrack,
      cameraTrack: this.cameraTrack,
      screenTrack: this.screenTrack,
    };
  }

  stopAll(): void {
    this.microphoneTrack?.stop();
    this.cameraTrack?.stop();
    this.screenTrack?.stop();
    this.microphoneTrack = null;
    this.cameraTrack = null;
    this.screenTrack = null;
  }
}
```

- [ ] **Step 3: Commit local media controller**

```bash
git add features/webrtc-meeting/media
git commit -m "feat: add local media controller"
```

## Task 9: Stats Collector

**Files:**
- Create: `features/webrtc-meeting/stats/StatsCollector.ts`
- Create: `features/webrtc-meeting/stats/StatsCollector.test.ts`

- [ ] **Step 1: Write stats normalization tests**

Create `features/webrtc-meeting/stats/StatsCollector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeStatsReport } from "./StatsCollector";

describe("normalizeStatsReport", () => {
  it("normalizes outbound RTP and candidate pair stats", () => {
    const report = new Map<string, any>([
      ["outbound-video", {
        type: "outbound-rtp",
        kind: "video",
        bytesSent: 120000,
        packetsLost: 2,
        framesPerSecond: 30,
        frameWidth: 1280,
        frameHeight: 720,
      }],
      ["candidate", {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.023,
        localCandidateId: "local",
        remoteCandidateId: "remote",
      }],
    ]);

    const stats = normalizeStatsReport(report as unknown as RTCStatsReport, null);

    expect(stats.packetsLost).toBe(2);
    expect(stats.roundTripTimeMs).toBe(23);
    expect(stats.framesPerSecond).toBe(30);
    expect(stats.width).toBe(1280);
    expect(stats.height).toBe(720);
  });
});
```

- [ ] **Step 2: Run stats test and verify failure**

Run:

```bash
npm run test -- features/webrtc-meeting/stats/StatsCollector.test.ts
```

Expected: FAIL because `StatsCollector.ts` does not exist.

- [ ] **Step 3: Implement stats collector**

Create `features/webrtc-meeting/stats/StatsCollector.ts`:

```ts
import type { MeetingStatsSnapshot } from "../types";

export function normalizeStatsReport(
  report: RTCStatsReport,
  previous: { bytesSent: number; timestamp: number } | null
): MeetingStatsSnapshot {
  let bytesSent = 0;
  let packetsLost = 0;
  let roundTripTimeMs = 0;
  let framesPerSecond = 0;
  let width = 0;
  let height = 0;
  let timestamp = Date.now();
  let candidatePair = "";

  report.forEach((stat) => {
    if (stat.type === "outbound-rtp" && (stat as any).kind === "video") {
      bytesSent = (stat as any).bytesSent || bytesSent;
      packetsLost = (stat as any).packetsLost || packetsLost;
      framesPerSecond = (stat as any).framesPerSecond || framesPerSecond;
      width = (stat as any).frameWidth || width;
      height = (stat as any).frameHeight || height;
      timestamp = (stat as any).timestamp || timestamp;
    }

    if (stat.type === "candidate-pair" && (stat as any).state === "succeeded") {
      const rttSeconds = (stat as any).currentRoundTripTime || 0;
      roundTripTimeMs = Math.round(rttSeconds * 1000);
      candidatePair = `${(stat as any).localCandidateId || "local"} -> ${(stat as any).remoteCandidateId || "remote"}`;
    }
  });

  const bitrateKbps =
    previous && timestamp > previous.timestamp
      ? Math.round(((bytesSent - previous.bytesSent) * 8) / (timestamp - previous.timestamp))
      : 0;

  return {
    bitrateKbps,
    packetsLost,
    roundTripTimeMs,
    framesPerSecond,
    width,
    height,
    candidatePair,
  };
}

function readOutboundVideoCounter(report: RTCStatsReport): { bytesSent: number; timestamp: number } {
  let counter = { bytesSent: 0, timestamp: Date.now() };
  report.forEach((stat) => {
    if (stat.type === "outbound-rtp" && (stat as any).kind === "video") {
      counter = {
        bytesSent: (stat as any).bytesSent || 0,
        timestamp: (stat as any).timestamp || Date.now(),
      };
    }
  });
  return counter;
}

export class StatsCollector {
  private intervalId: number | null = null;
  private previous: { bytesSent: number; timestamp: number } | null = null;

  constructor(
    private readonly peerConnection: RTCPeerConnection,
    private readonly onStats: (stats: MeetingStatsSnapshot) => void
  ) {}

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = window.setInterval(async () => {
      const report = await this.peerConnection.getStats();
      const stats = normalizeStatsReport(report, this.previous);
      this.previous = readOutboundVideoCounter(report);
      this.onStats(stats);
    }, 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.previous = null;
  }
}
```

- [ ] **Step 4: Run stats tests and commit**

Run:

```bash
npm run test -- features/webrtc-meeting/stats/StatsCollector.test.ts
```

Expected: PASS.

Commit:

```bash
git add features/webrtc-meeting/stats
git commit -m "feat: add webrtc stats collector"
```

## Task 10: Peer Connection Engine

**Files:**
- Create: `features/webrtc-meeting/peer/PeerConnectionEngine.ts`
- Create: `features/webrtc-meeting/peer/PeerConnectionEngine.test.ts`

- [ ] **Step 1: Write negotiation role tests**

Create `features/webrtc-meeting/peer/PeerConnectionEngine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldIgnoreOffer } from "./PeerConnectionEngine";

describe("perfect negotiation helpers", () => {
  it("impolite participant ignores offer collision", () => {
    expect(shouldIgnoreOffer({
      polite: false,
      makingOffer: true,
      signalingState: "have-local-offer",
    })).toBe(true);
  });

  it("polite participant accepts offer collision", () => {
    expect(shouldIgnoreOffer({
      polite: true,
      makingOffer: true,
      signalingState: "have-local-offer",
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run peer test and verify failure**

Run:

```bash
npm run test -- features/webrtc-meeting/peer/PeerConnectionEngine.test.ts
```

Expected: FAIL because `PeerConnectionEngine.ts` does not exist.

- [ ] **Step 3: Implement peer engine**

Create `features/webrtc-meeting/peer/PeerConnectionEngine.ts`:

```ts
import type { ParticipantRole } from "../protocol/messages";

export function shouldIgnoreOffer(input: {
  polite: boolean;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
}): boolean {
  const offerCollision = input.makingOffer || input.signalingState !== "stable";
  return !input.polite && offerCollision;
}

export interface PeerConnectionEngineOptions {
  role: ParticipantRole;
  iceServers: RTCIceServer[];
  onLocalDescription: (description: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onRemoteTrack: (event: RTCTrackEvent) => void;
  onConnectionState: (state: {
    peerConnectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
  }) => void;
  onDataMessage: (message: string) => void;
  onLog: (message: string, data?: unknown) => void;
}

export class PeerConnectionEngine {
  private pc: RTCPeerConnection | null = null;
  private microphoneSender: RTCRtpSender | null = null;
  private cameraSender: RTCRtpSender | null = null;
  private screenSender: RTCRtpSender | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private makingOffer = false;

  constructor(private readonly options: PeerConnectionEngineOptions) {}

  create(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });
    this.pc = pc;

    this.microphoneSender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
    this.cameraSender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    this.screenSender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;

    pc.onicecandidate = (event) => {
      if (event.candidate) this.options.onIceCandidate(event.candidate.toJSON());
    };

    pc.ontrack = (event) => this.options.onRemoteTrack(event);

    pc.onconnectionstatechange = () => this.emitConnectionState();
    pc.oniceconnectionstatechange = () => this.emitConnectionState();

    pc.onnegotiationneeded = () => {
      this.negotiate().catch((error) => this.options.onLog("Negotiation failed", error));
    };

    if (this.options.role === "caller") {
      this.dataChannel = pc.createDataChannel("chat", { ordered: true });
      this.configureDataChannel(this.dataChannel);
    } else {
      pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.configureDataChannel(event.channel);
      };
    }

    return pc;
  }

  async negotiate(): Promise<void> {
    const pc = this.requirePeerConnection();
    try {
      this.makingOffer = true;
      await pc.setLocalDescription();
      if (pc.localDescription) this.options.onLocalDescription(pc.localDescription.toJSON());
    } finally {
      this.makingOffer = false;
    }
  }

  async applyRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.requirePeerConnection();
    const polite = this.options.role === "answerer";
    if (description.type === "offer" && shouldIgnoreOffer({
      polite,
      makingOffer: this.makingOffer,
      signalingState: pc.signalingState,
    })) {
      this.options.onLog("Ignored offer collision");
      return;
    }

    await pc.setRemoteDescription(description);
    if (description.type === "offer") {
      await pc.setLocalDescription();
      if (pc.localDescription) this.options.onLocalDescription(pc.localDescription.toJSON());
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.requirePeerConnection().addIceCandidate(candidate);
  }

  async setMicrophoneTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.microphoneSender?.replaceTrack(track);
  }

  async setCameraTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.cameraSender?.replaceTrack(track);
  }

  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.screenSender?.replaceTrack(track);
  }

  sendDataMessage(message: string): boolean {
    if (this.dataChannel?.readyState !== "open") return false;
    this.dataChannel.send(message);
    return true;
  }

  getPeerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.dataChannel = null;
    this.pc = null;
  }

  private configureDataChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => this.options.onDataMessage(String(event.data));
  }

  private emitConnectionState(): void {
    const pc = this.requirePeerConnection();
    this.options.onConnectionState({
      peerConnectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
    });
  }

  private requirePeerConnection(): RTCPeerConnection {
    if (!this.pc) throw new Error("Peer connection has not been created.");
    return this.pc;
  }
}
```

- [ ] **Step 4: Run peer tests and commit**

Run:

```bash
npm run test -- features/webrtc-meeting/peer/PeerConnectionEngine.test.ts
```

Expected: PASS.

Commit:

```bash
git add features/webrtc-meeting/peer
git commit -m "feat: add peer connection engine"
```

## Task 11: Meeting Controller Hook

**Files:**
- Create: `features/webrtc-meeting/hooks/useMeetingController.ts`

- [ ] **Step 1: Implement lifecycle hook**

Create `features/webrtc-meeting/hooks/useMeetingController.ts`:

```ts
"use client";

import { useCallback, useMemo, useRef } from "react";
import { getInitialIceServers, parseIceServers } from "../config/ice";
import { createEventLogger } from "../logging/EventLogger";
import { LocalMediaController } from "../media/LocalMediaController";
import { PeerConnectionEngine } from "../peer/PeerConnectionEngine";
import {
  createClientMessageId,
  createJoinRoomMessage,
  createParticipantId,
  normalizeRoomId,
  type SignalMessage,
} from "../protocol/messages";
import { SignalingClient } from "../signaling/SignalingClient";
import { useMeetingDispatch, useMeetingState } from "../store/MeetingProvider";
import { StatsCollector } from "../stats/StatsCollector";

export function useMeetingController() {
  const state = useMeetingState();
  const dispatch = useMeetingDispatch();
  const participantIdRef = useRef(createParticipantId());
  const mediaRef = useRef(new LocalMediaController());
  const loggerRef = useRef(createEventLogger());
  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<PeerConnectionEngine | null>(null);
  const statsRef = useRef<StatsCollector | null>(null);

  const publishLogs = useCallback(() => {
    dispatch({ type: "logs-updated", logs: loggerRef.current.getEvents() });
  }, [dispatch]);

  const sendSignal = useCallback((message: SignalMessage) => {
    loggerRef.current.append("signaling", `send ${message.type}`, message);
    publishLogs();
    signalingRef.current?.send(message);
  }, [publishLogs]);

  const createMessageBase = useCallback(() => ({
    roomId: state.roomId,
    participantId: participantIdRef.current,
    messageId: createClientMessageId(),
    sentAt: Date.now(),
  }), [state.roomId]);

  const ensurePeer = useCallback((role: "caller" | "answerer", iceInput?: string) => {
    if (peerRef.current?.getPeerConnection()) return peerRef.current;
    const engine = new PeerConnectionEngine({
      role,
      iceServers: iceInput ? parseIceServers(iceInput) : getInitialIceServers(),
      onLocalDescription: (description) => {
        sendSignal({
          ...createMessageBase(),
          type: description.type === "offer" ? "offer" : "answer",
          description,
        } as SignalMessage);
      },
      onIceCandidate: (candidate) => {
        sendSignal({ ...createMessageBase(), type: "ice-candidate", candidate });
      },
      onRemoteTrack: (event) => {
        loggerRef.current.append("peer", "remote track", { kind: event.track.kind, mid: event.transceiver.mid });
        publishLogs();
      },
      onConnectionState: (connectionState) => {
        dispatch({ type: "connection-state-changed", ...connectionState });
      },
      onDataMessage: (raw) => {
        const parsed = JSON.parse(raw);
        dispatch({ type: "chat-added", entry: { ...parsed, delivery: "received" } });
      },
      onLog: (message, data) => {
        loggerRef.current.append("peer", message, data);
        publishLogs();
      },
    });
    engine.create();
    peerRef.current = engine;
    return engine;
  }, [createMessageBase, dispatch, publishLogs, sendSignal]);

  const handleSignal = useCallback(async (message: SignalMessage) => {
    loggerRef.current.append("signaling", `receive ${message.type}`, message);
    publishLogs();

    if (message.type === "room-snapshot") {
      dispatch({
        type: "joined-room",
        roomId: message.roomId,
        participantId: participantIdRef.current,
        displayName: state.displayName,
        role: message.self.role,
        peer: message.peer,
      });
      if (message.peer) ensurePeer(message.self.role);
      return;
    }

    if (message.type === "peer-joined") {
      dispatch({ type: "peer-joined", peer: message.peer });
      const engine = ensurePeer(state.localParticipant?.role || "caller");
      if (state.localParticipant?.role === "caller") await engine.negotiate();
      return;
    }

    if (message.type === "peer-left") {
      peerRef.current?.close();
      peerRef.current = null;
      dispatch({ type: "peer-left", peerParticipantId: message.peerParticipantId });
      return;
    }

    if (message.type === "offer" || message.type === "answer") {
      const role = state.localParticipant?.role || (message.type === "offer" ? "answerer" : "caller");
      await ensurePeer(role).applyRemoteDescription(message.description);
      return;
    }

    if (message.type === "ice-candidate") {
      await peerRef.current?.addIceCandidate(message.candidate);
      return;
    }

    if (message.type === "media-state") {
      dispatch({ type: "remote-media", media: message.media });
      return;
    }

    if (message.type === "room-full" || message.type === "error") {
      dispatch({ type: "error", error: message.message });
    }
  }, [dispatch, ensurePeer, publishLogs, state.displayName, state.localParticipant?.role]);

  const join = useCallback(async (input: {
    roomId: string;
    displayName: string;
    signalingUrl: string;
    iceServersInput?: string;
  }) => {
    const roomId = normalizeRoomId(input.roomId);
    const displayName = input.displayName.trim() || "Guest";
    dispatch({ type: "set-joining", roomId, participantId: participantIdRef.current, displayName });

    const signaling = new SignalingClient({
      url: input.signalingUrl,
      onMessage: (message) => void handleSignal(message),
      onStateChange: (websocketState) => dispatch({ type: "websocket-state", websocketState }),
      onError: (error) => dispatch({ type: "error", error }),
    });
    signalingRef.current = signaling;
    await signaling.connect();
    signaling.join(createJoinRoomMessage({ roomId, participantId: participantIdRef.current, displayName }));
  }, [dispatch, handleSignal]);

  const startCamera = useCallback(async () => {
    const track = await mediaRef.current.startCamera(state.localMedia.selectedCameraId || undefined);
    dispatch({ type: "local-media", media: { cameraOn: true } });
    await peerRef.current?.setCameraTrack(track);
  }, [dispatch, state.localMedia.selectedCameraId]);

  const toggleCamera = useCallback(async () => {
    if (state.localMedia.cameraOn) {
      mediaRef.current.setCameraEnabled(false);
      dispatch({ type: "local-media", media: { cameraOn: false } });
      return;
    }
    await startCamera();
  }, [dispatch, startCamera, state.localMedia.cameraOn]);

  const startMicrophone = useCallback(async () => {
    const track = await mediaRef.current.startMicrophone(state.localMedia.selectedMicrophoneId || undefined);
    dispatch({ type: "local-media", media: { micOn: true } });
    await peerRef.current?.setMicrophoneTrack(track);
  }, [dispatch, state.localMedia.selectedMicrophoneId]);

  const toggleMicrophone = useCallback(async () => {
    if (state.localMedia.micOn) {
      mediaRef.current.setMicrophoneEnabled(false);
      dispatch({ type: "local-media", media: { micOn: false } });
      return;
    }
    await startMicrophone();
  }, [dispatch, startMicrophone, state.localMedia.micOn]);

  const toggleScreenShare = useCallback(async () => {
    if (state.localMedia.screenSharing) {
      mediaRef.current.stopScreenShare();
      await peerRef.current?.setScreenTrack(null);
      dispatch({ type: "local-media", media: { screenSharing: false } });
      return;
    }
    const track = await mediaRef.current.startScreenShare(() => {
      void peerRef.current?.setScreenTrack(null);
      dispatch({ type: "local-media", media: { screenSharing: false } });
    });
    await peerRef.current?.setScreenTrack(track);
    dispatch({ type: "local-media", media: { screenSharing: true } });
  }, [dispatch, state.localMedia.screenSharing]);

  const sendChat = useCallback((body: string) => {
    const entry = {
      id: createClientMessageId(),
      participantId: participantIdRef.current,
      displayName: state.displayName || "Guest",
      body,
      createdAt: Date.now(),
      delivery: "sent" as const,
    };
    peerRef.current?.sendDataMessage(JSON.stringify(entry));
    dispatch({ type: "chat-added", entry });
  }, [dispatch, state.displayName]);

  const leave = useCallback(() => {
    mediaRef.current.stopAll();
    statsRef.current?.stop();
    peerRef.current?.close();
    signalingRef.current?.close();
    dispatch({ type: "left" });
  }, [dispatch]);

  return useMemo(() => ({
    state,
    join,
    leave,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    sendChat,
  }), [join, leave, sendChat, state, toggleCamera, toggleMicrophone, toggleScreenShare]);
}
```

- [ ] **Step 2: Commit controller hook**

```bash
git add features/webrtc-meeting/hooks/useMeetingController.ts
git commit -m "feat: add webrtc meeting controller hook"
```

## Task 12: React UI Components

**Files:**
- Create: `features/webrtc-meeting/EmbeddedApp.tsx`
- Create: `features/webrtc-meeting/components/JoinScreen.tsx`
- Create: `features/webrtc-meeting/components/MeetingShell.tsx`
- Create: `features/webrtc-meeting/components/StatusBar.tsx`
- Create: `features/webrtc-meeting/components/VideoStage.tsx`
- Create: `features/webrtc-meeting/components/MediaTile.tsx`
- Create: `features/webrtc-meeting/components/ControlBar.tsx`
- Create: `features/webrtc-meeting/components/SidePanel.tsx`
- Create: `features/webrtc-meeting/components/DeviceMenu.tsx`
- Create: `features/webrtc-meeting/components/EmptyState.tsx`
- Create: `features/webrtc-meeting/styles.module.css`

- [ ] **Step 1: Create feature shell**

Create `features/webrtc-meeting/EmbeddedApp.tsx`:

```tsx
"use client";

import { MeetingProvider } from "./store/MeetingProvider";
import { MeetingShell } from "./components/MeetingShell";

export default function EmbeddedWebRtcMeetingApp() {
  return (
    <MeetingProvider>
      <MeetingShell />
    </MeetingProvider>
  );
}
```

- [ ] **Step 2: Create join screen**

Create `features/webrtc-meeting/components/JoinScreen.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Video } from "lucide-react";
import styles from "../styles.module.css";

export function JoinScreen({
  onJoin,
  error,
}: {
  error: string;
  onJoin: (input: {
    roomId: string;
    displayName: string;
    signalingUrl: string;
    iceServersInput: string;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState("Guest");
  const [roomId, setRoomId] = useState("");
  const [signalingUrl, setSignalingUrl] = useState(
    process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:8787"
  );
  const [iceServersInput, setIceServersInput] = useState("");

  return (
    <section className={styles.joinScreen}>
      <div className={styles.joinPanel}>
        <div className={styles.brandRow}>
          <Video size={28} />
          <div>
            <h1>WebRTC Meeting</h1>
            <p>Two-person peer-to-peer meeting prototype</p>
          </div>
        </div>
        {error && <div className={styles.errorBanner}>{error}</div>}
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Room ID
          <input value={roomId} placeholder="demo-room" onChange={(event) => setRoomId(event.target.value)} />
        </label>
        <label>
          Signaling URL
          <input value={signalingUrl} onChange={(event) => setSignalingUrl(event.target.value)} />
        </label>
        <label>
          ICE servers JSON
          <textarea
            value={iceServersInput}
            placeholder='[{"urls":"stun:stun.l.google.com:19302"}]'
            onChange={(event) => setIceServersInput(event.target.value)}
          />
        </label>
        <button
          className={styles.primaryButton}
          onClick={() => onJoin({ displayName, roomId, signalingUrl, iceServersInput })}
        >
          Create or Join
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create meeting shell**

Create `features/webrtc-meeting/components/MeetingShell.tsx`:

```tsx
"use client";

import { JoinScreen } from "./JoinScreen";
import { StatusBar } from "./StatusBar";
import { VideoStage } from "./VideoStage";
import { ControlBar } from "./ControlBar";
import { SidePanel } from "./SidePanel";
import { useMeetingController } from "../hooks/useMeetingController";
import styles from "../styles.module.css";

export function MeetingShell() {
  const controller = useMeetingController();
  const { state } = controller;

  if (state.lifecycle === "idle" || state.lifecycle === "left" || state.lifecycle === "failed") {
    return <JoinScreen error={state.error} onJoin={controller.join} />;
  }

  return (
    <div className={styles.meetingRoot}>
      <StatusBar state={state} />
      <main className={styles.meetingMain}>
        <VideoStage state={state} />
        <SidePanel state={state} onSendChat={controller.sendChat} />
      </main>
      <ControlBar
        state={state}
        onToggleMic={controller.toggleMicrophone}
        onToggleCamera={controller.toggleCamera}
        onToggleShare={controller.toggleScreenShare}
        onLeave={controller.leave}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create status and media components**

Create `features/webrtc-meeting/components/StatusBar.tsx`:

```tsx
import { Copy } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function StatusBar({ state }: { state: MeetingState }) {
  return (
    <header className={styles.statusBar}>
      <span>Room {state.roomId}</span>
      <span>{state.lifecycle}</span>
      <span>WS {state.websocketState}</span>
      <span>PC {state.peerConnectionState}</span>
      <span>ICE {state.iceConnectionState}</span>
      <button
        className={styles.iconButton}
        onClick={() => navigator.clipboard.writeText(window.location.href)}
        title="Copy link"
      >
        <Copy size={16} />
      </button>
    </header>
  );
}
```

Create `features/webrtc-meeting/components/MediaTile.tsx`:

```tsx
import { useEffect, useRef } from "react";
import styles from "../styles.module.css";

export function MediaTile({
  label,
  stream,
  muted = false,
  active,
}: {
  label: string;
  stream: MediaStream | null;
  muted?: boolean;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <section className={styles.mediaTile}>
      {stream && active ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      ) : (
        <div className={styles.mediaEmpty}>{label}</div>
      )}
      <span className={styles.tileLabel}>{label}</span>
    </section>
  );
}
```

Create `features/webrtc-meeting/components/VideoStage.tsx`:

```tsx
import type { MeetingState } from "../types";
import { MediaTile } from "./MediaTile";
import styles from "../styles.module.css";

export function VideoStage({ state }: { state: MeetingState }) {
  return (
    <section className={styles.videoStage}>
      {state.remoteMedia.screenSharing ? (
        <div className={styles.shareLayout}>
          <MediaTile label="Remote screen" stream={null} active={state.remoteMedia.screenSharing} />
          <div className={styles.sideTiles}>
            <MediaTile label="Remote camera" stream={null} active={state.remoteMedia.cameraOn} />
            <MediaTile label="You" stream={null} muted active={state.localMedia.cameraOn} />
          </div>
        </div>
      ) : (
        <div className={styles.gridLayout}>
          <MediaTile label="Remote camera" stream={null} active={state.remoteMedia.cameraOn} />
          <MediaTile label="You" stream={null} muted active={state.localMedia.cameraOn} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Create control and side panel components**

Create `features/webrtc-meeting/components/ControlBar.tsx`:

```tsx
import { Mic, MicOff, MonitorUp, PhoneOff, Radio, Video, VideoOff } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function ControlBar({
  state,
  onToggleMic,
  onToggleCamera,
  onToggleShare,
  onLeave,
}: {
  state: MeetingState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onLeave: () => void;
}) {
  return (
    <footer className={styles.controlBar}>
      <button className={styles.roundButton} onClick={onToggleMic} title="Toggle microphone">
        {state.localMedia.micOn ? <Mic /> : <MicOff />}
      </button>
      <button className={styles.roundButton} onClick={onToggleCamera} title="Toggle camera">
        {state.localMedia.cameraOn ? <Video /> : <VideoOff />}
      </button>
      <button className={styles.roundButton} onClick={onToggleShare} title="Share screen">
        <MonitorUp />
      </button>
      <button className={styles.roundButton} title="Recording reserved">
        <Radio />
      </button>
      <button className={styles.leaveButton} onClick={onLeave}>
        <PhoneOff size={18} /> Leave
      </button>
    </footer>
  );
}
```

Create `features/webrtc-meeting/components/SidePanel.tsx`:

```tsx
import { useState } from "react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function SidePanel({
  state,
  onSendChat,
}: {
  state: MeetingState;
  onSendChat: (body: string) => void;
}) {
  const [tab, setTab] = useState<"chat" | "stats" | "logs">("chat");
  const [message, setMessage] = useState("");

  return (
    <aside className={styles.sidePanel}>
      <div className={styles.tabs}>
        {(["chat", "stats", "logs"] as const).map((name) => (
          <button key={name} className={tab === name ? styles.activeTab : ""} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      {tab === "chat" && (
        <div className={styles.panelBody}>
          <div className={styles.chatList}>
            {state.chat.map((entry) => (
              <div key={entry.id} className={styles.chatMessage}>
                <strong>{entry.displayName}</strong>
                <p>{entry.body}</p>
              </div>
            ))}
          </div>
          <form
            className={styles.chatForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (!message.trim()) return;
              onSendChat(message.trim());
              setMessage("");
            }}
          >
            <input value={message} onChange={(event) => setMessage(event.target.value)} />
            <button>Send</button>
          </form>
        </div>
      )}
      {tab === "stats" && (
        <pre className={styles.preBlock}>{JSON.stringify(state.stats, null, 2)}</pre>
      )}
      {tab === "logs" && (
        <pre className={styles.preBlock}>{state.logs.map((log) => `${log.kind}: ${log.message}`).join("\n")}</pre>
      )}
    </aside>
  );
}
```

- [ ] **Step 6: Create remaining small components**

Create `features/webrtc-meeting/components/DeviceMenu.tsx`:

```tsx
export function DeviceMenu() {
  return null;
}
```

Create `features/webrtc-meeting/components/EmptyState.tsx`:

```tsx
import styles from "../styles.module.css";

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.emptyState}>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}
```

- [ ] **Step 7: Create CSS module**

Create `features/webrtc-meeting/styles.module.css`:

```css
.joinScreen {
  min-height: 88vh;
  display: grid;
  place-items: center;
  background: #0f172a;
  color: #f8fafc;
}

.joinPanel {
  width: min(560px, calc(100vw - 32px));
  display: grid;
  gap: 16px;
  padding: 28px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.96);
}

.brandRow {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brandRow h1 {
  margin: 0;
  font-size: 28px;
}

.brandRow p {
  margin: 4px 0 0;
  color: #94a3b8;
}

.joinPanel label {
  display: grid;
  gap: 6px;
  color: #cbd5e1;
  font-size: 13px;
}

.joinPanel input,
.joinPanel textarea {
  width: 100%;
  border: 1px solid #334155;
  background: #020617;
  color: #f8fafc;
  padding: 10px 12px;
}

.joinPanel textarea {
  min-height: 84px;
  resize: vertical;
}

.primaryButton,
.leaveButton,
.roundButton,
.iconButton,
.tabs button,
.chatForm button {
  border: 0;
  cursor: pointer;
}

.primaryButton {
  height: 44px;
  background: #2563eb;
  color: white;
  font-weight: 700;
}

.errorBanner {
  border: 1px solid #ef4444;
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
  padding: 10px 12px;
}

.meetingRoot {
  min-height: 88vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: #0f172a;
  color: #f8fafc;
}

.statusBar {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  font-size: 13px;
}

.iconButton {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  margin-left: auto;
  background: transparent;
  color: #cbd5e1;
}

.meetingMain {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
}

.videoStage {
  min-width: 0;
  min-height: 0;
  padding: 18px;
}

.gridLayout {
  height: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.shareLayout {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 14px;
}

.sideTiles {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 14px;
}

.mediaTile {
  position: relative;
  min-height: 180px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #020617;
  border: 1px solid rgba(148, 163, 184, 0.24);
}

.mediaTile video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mediaEmpty {
  color: #94a3b8;
}

.tileLabel {
  position: absolute;
  left: 10px;
  bottom: 10px;
  background: rgba(2, 6, 23, 0.72);
  color: #f8fafc;
  padding: 4px 8px;
  font-size: 12px;
}

.sidePanel {
  min-width: 0;
  border-left: 1px solid rgba(148, 163, 184, 0.2);
  background: #111827;
  display: grid;
  grid-template-rows: auto 1fr;
}

.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

.tabs button {
  height: 40px;
  background: transparent;
  color: #94a3b8;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  text-transform: capitalize;
}

.tabs .activeTab {
  color: #f8fafc;
  border-bottom-color: #2563eb;
}

.panelBody {
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr auto;
}

.chatList {
  overflow: auto;
  padding: 12px;
}

.chatMessage {
  padding: 10px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.chatMessage p {
  margin: 4px 0 0;
  color: #cbd5e1;
}

.chatForm {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.chatForm input {
  min-width: 0;
  background: #020617;
  border: 1px solid #334155;
  color: #f8fafc;
  padding: 9px 10px;
}

.chatForm button {
  background: #2563eb;
  color: white;
  padding: 0 14px;
}

.preBlock {
  overflow: auto;
  margin: 0;
  padding: 12px;
  color: #cbd5e1;
  font-size: 12px;
}

.controlBar {
  min-height: 68px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.96);
}

.roundButton {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #1e293b;
  color: #f8fafc;
}

.leaveButton {
  height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: #dc2626;
  color: white;
  font-weight: 700;
}

.emptyState {
  display: grid;
  place-items: center;
  color: #94a3b8;
}

@media (max-width: 960px) {
  .meetingMain {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) 320px;
  }

  .sidePanel {
    border-left: 0;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
  }

  .gridLayout,
  .shareLayout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Commit UI components**

```bash
git add features/webrtc-meeting/EmbeddedApp.tsx features/webrtc-meeting/components features/webrtc-meeting/styles.module.css
git commit -m "feat: add webrtc meeting UI shell"
```

## Task 13: Route And Home Card Integration

**Files:**
- Create: `app/test/webrtc-meeting/page.tsx`
- Modify: `config/testPages.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create test route**

Create `app/test/webrtc-meeting/page.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";

const EmbeddedWebRtcMeetingApp = dynamic(
  () => import("@/features/webrtc-meeting/EmbeddedApp"),
  { ssr: false }
);

export default function WebRtcMeetingPage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <EmbeddedWebRtcMeetingApp />
    </div>
  );
}
```

- [ ] **Step 2: Add test card config**

Add this object to `testPages` in `config/testPages.ts`, near the other media tests:

```ts
{
  id: "webrtc-meeting",
  title: "WebRTC Meeting",
  description: "Two-person P2P meeting with signaling, media, chat, and stats",
  icon: "Users",
  path: "/test/webrtc-meeting",
  category: "Media"
}
```

- [ ] **Step 3: Add icon mapping**

Update `app/page.tsx` import and `iconMap`:

```ts
import {
  Video,
  Mic,
  Wifi,
  Info,
  Monitor,
  Camera,
  TestTube,
  Bug,
  Cpu,
  Zap,
  Users,
} from "lucide-react";
```

```ts
const iconMap: Record<string, React.ComponentType<any>> = {
  Video,
  Mic,
  Wifi,
  Info,
  Monitor,
  Camera,
  TestTube,
  Bug,
  Cpu,
  Zap,
  Users,
};
```

- [ ] **Step 4: Build route**

Run:

```bash
npm run build
```

Expected: Next.js build completes. If it fails on feature-local type errors, fix the type errors before proceeding. If it fails on unrelated existing pages, capture the exact errors and keep the feature changes intact.

- [ ] **Step 5: Commit route integration**

```bash
git add app/test/webrtc-meeting/page.tsx config/testPages.ts app/page.tsx
git commit -m "feat: add webrtc meeting test page"
```

## Task 14: Wire Remote Streams And Media State

**Files:**
- Modify: `features/webrtc-meeting/hooks/useMeetingController.ts`
- Modify: `features/webrtc-meeting/types.ts`
- Modify: `features/webrtc-meeting/store/meetingReducer.ts`
- Modify: `features/webrtc-meeting/components/VideoStage.tsx`

- [ ] **Step 1: Extend state with stream references**

Update `features/webrtc-meeting/types.ts`:

```ts
export interface MeetingStreams {
  localCamera: MediaStream | null;
  remoteCamera: MediaStream | null;
  remoteScreen: MediaStream | null;
}
```

Add to `MeetingState`:

```ts
streams: MeetingStreams;
```

- [ ] **Step 2: Add reducer action**

Update `MeetingAction` in `features/webrtc-meeting/store/meetingReducer.ts`:

```ts
| { type: "streams-updated"; streams: Partial<MeetingState["streams"]> }
```

Add to initial state:

```ts
streams: {
  localCamera: null,
  remoteCamera: null,
  remoteScreen: null,
},
```

Add reducer case:

```ts
case "streams-updated":
  return { ...state, streams: { ...state.streams, ...action.streams } };
```

- [ ] **Step 3: Dispatch local and remote streams**

In `useMeetingController.ts`, import helper:

```ts
import { createStreamFromTrack } from "../media/mediaStreams";
```

In `startCamera`, after camera track creation:

```ts
dispatch({ type: "streams-updated", streams: { localCamera: createStreamFromTrack(track) } });
```

In `onRemoteTrack`, classify stream by transceiver mid:

```ts
const stream = event.streams[0] || createStreamFromTrack(event.track);
const mid = event.transceiver.mid;
dispatch({
  type: "streams-updated",
  streams: mid === "2" ? { remoteScreen: stream } : { remoteCamera: stream },
});
```

- [ ] **Step 4: Pass streams into video stage**

Update `VideoStage.tsx` `MediaTile` calls:

```tsx
<MediaTile label="Remote screen" stream={state.streams.remoteScreen} active={state.remoteMedia.screenSharing} />
<MediaTile label="Remote camera" stream={state.streams.remoteCamera} active={state.remoteMedia.cameraOn} />
<MediaTile label="You" stream={state.streams.localCamera} muted active={state.localMedia.cameraOn} />
```

- [ ] **Step 5: Send media-state on local toggles**

In `useMeetingController.ts`, after local mic/camera/share state changes, call:

```ts
sendSignal({
  ...createMessageBase(),
  type: "media-state",
  media: {
    micOn: nextMicState,
    cameraOn: nextCameraState,
    screenSharing: nextScreenSharingState,
  },
});
```

- [ ] **Step 6: Run build and commit**

Run:

```bash
npm run build
```

Expected: build succeeds or only reports unrelated existing failures.

Commit:

```bash
git add features/webrtc-meeting
git commit -m "feat: wire webrtc meeting media streams"
```

## Task 15: Device Selection And Diagnostics Polish

**Files:**
- Modify: `features/webrtc-meeting/hooks/useMeetingController.ts`
- Modify: `features/webrtc-meeting/components/DeviceMenu.tsx`
- Modify: `features/webrtc-meeting/components/ControlBar.tsx`
- Modify: `features/webrtc-meeting/components/SidePanel.tsx`

- [ ] **Step 1: Implement device refresh in controller**

Add controller method:

```ts
const refreshDevices = useCallback(async () => {
  const devices = await mediaRef.current.enumerateDevices();
  dispatch({
    type: "local-media",
    media: {
      cameras: devices.cameras,
      microphones: devices.microphones,
    },
  });
}, [dispatch]);
```

Return it from `useMeetingController`.

- [ ] **Step 2: Implement device menu**

Replace `DeviceMenu.tsx`:

```tsx
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function DeviceMenu({
  state,
  onCameraChange,
  onMicrophoneChange,
}: {
  state: MeetingState;
  onCameraChange: (deviceId: string) => void;
  onMicrophoneChange: (deviceId: string) => void;
}) {
  return (
    <div className={styles.deviceMenu}>
      <label>
        Camera
        <select value={state.localMedia.selectedCameraId} onChange={(event) => onCameraChange(event.target.value)}>
          <option value="">Default camera</option>
          {state.localMedia.cameras.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label || device.deviceId}</option>
          ))}
        </select>
      </label>
      <label>
        Microphone
        <select value={state.localMedia.selectedMicrophoneId} onChange={(event) => onMicrophoneChange(event.target.value)}>
          <option value="">Default microphone</option>
          {state.localMedia.microphones.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label || device.deviceId}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Add device selectors to control area**

Wire `DeviceMenu` in `ControlBar` or `MeetingShell` with callbacks that dispatch:

```ts
dispatch({ type: "local-media", media: { selectedCameraId: deviceId } });
dispatch({ type: "local-media", media: { selectedMicrophoneId: deviceId } });
```

When the selected device changes and the track is active, restart that track and call `replaceTrack()`.

- [ ] **Step 4: Improve stats/logs copy controls**

In `SidePanel.tsx`, add buttons:

```tsx
<button onClick={() => navigator.clipboard.writeText(JSON.stringify(state.stats, null, 2))}>Copy stats</button>
<button onClick={() => navigator.clipboard.writeText(state.logs.map((log) => `${log.kind}: ${log.message}`).join("\n"))}>Copy logs</button>
```

- [ ] **Step 5: Build and commit**

Run:

```bash
npm run build
```

Expected: build succeeds or only reports unrelated existing failures.

Commit:

```bash
git add features/webrtc-meeting
git commit -m "feat: add webrtc devices and diagnostics polish"
```

## Task 16: Full Verification

**Files:**
- Modify only the feature files that fail verification, with the exact changed files listed in the verification commit.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm run test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: Next.js build succeeds. If existing non-feature code fails, capture exact failures and ensure no WebRTC feature errors are present.

- [ ] **Step 3: Start local app and signaling server**

Run:

```bash
npm run dev:webrtc
```

Expected:

- Signaling server prints `ws://localhost:8787`.
- Next.js app starts on `http://localhost:3000` or the next available port.

- [ ] **Step 4: Manual two-tab smoke test**

In two browser tabs:

1. Open `/test/webrtc-meeting`.
2. Join the same room with two display names.
3. Verify both participants reach connected state.
4. Toggle microphone.
5. Toggle camera.
6. Start screen share.
7. Stop screen share from the app.
8. Start screen share again and stop it from the browser sharing indicator.
9. Send chat messages in both directions.
10. Open stats and logs tabs.
11. Open a third tab with the same room and verify room-full state.
12. Leave from one tab and verify the other returns to waiting.

- [ ] **Step 5: Commit verification fixes**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: stabilize webrtc meeting smoke test"
```

If no fixes were needed:

```bash
git status --short
```

Expected: clean except ignored or unrelated user files.

## Self-Review Checklist

- Spec coverage: Tasks 1-4 cover runtime and signaling server. Tasks 5-7 cover protocol, config, logging, and browser signaling. Tasks 8-11 cover media, stats, peer engine, and controller. Tasks 12-15 cover UI, route integration, streams, devices, diagnostics, chat, and recording-reserved control. Task 16 covers build and manual browser verification.
- Phase 1 scope: The plan does not implement media processors, processor UI controls, real recording, SFU behavior, or auth.
- Type consistency: The plan uses `MeetingState`, `MeetingAction`, `SignalMessage`, `PeerConnectionEngine`, `LocalMediaController`, `StatsCollector`, and `SignalingClient` consistently across tasks.
