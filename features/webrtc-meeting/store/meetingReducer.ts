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
  | { type: "streams-updated"; streams: Partial<MeetingState["streams"]> }
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
    streams: {
      localCamera: null,
      remoteCamera: null,
      remoteScreen: null,
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
    case "websocket-state": {
      const disconnected =
        (action.websocketState === "closed" || action.websocketState === "error") &&
        state.lifecycle !== "idle" &&
        state.lifecycle !== "left" &&
        state.lifecycle !== "failed";
      return {
        ...state,
        websocketState: action.websocketState,
        ...(disconnected && {
          lifecycle: "failed",
          error: "Lost connection to signaling server.",
        }),
      };
    }
    case "local-media":
      return { ...state, localMedia: { ...state.localMedia, ...action.media } };
    case "remote-media":
      return { ...state, remoteMedia: { ...state.remoteMedia, ...action.media } };
    case "streams-updated":
      return { ...state, streams: { ...state.streams, ...action.streams } };
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
