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
