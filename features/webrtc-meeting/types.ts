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

export interface MeetingStreams {
  localCamera: MediaStream | null;
  remoteCamera: MediaStream | null;
  remoteScreen: MediaStream | null;
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
  streams: MeetingStreams;
  chat: ChatEntry[];
  logs: MeetingLogEvent[];
  stats: MeetingStatsSnapshot | null;
  error: string;
}
