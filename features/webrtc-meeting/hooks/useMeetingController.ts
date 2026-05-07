"use client";

import { useCallback, useMemo, useRef } from "react";
import { getInitialIceServers, parseIceServers } from "../config/ice";
import { createEventLogger } from "../logging/EventLogger";
import { LocalMediaController } from "../media/LocalMediaController";
import { createStreamFromTrack } from "../media/mediaStreams";
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
    if (peerRef.current) return peerRef.current;
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
        if (!candidate) return; // null signals end-of-candidates; nothing to send
        sendSignal({ ...createMessageBase(), type: "ice-candidate", candidate });
      },
      onRemoteTrack: (event) => {
        loggerRef.current.append("peer", "remote track", { kind: event.track.kind, mid: event.transceiver.mid });
        publishLogs();
        const stream = event.streams[0] || createStreamFromTrack(event.track);
        const mid = event.transceiver.mid;
        dispatch({
          type: "streams-updated",
          streams: mid === "2" ? { remoteScreen: stream } : { remoteCamera: stream },
        });
      },
      onConnectionState: (connectionState) => {
        dispatch({ type: "connection-state-changed", peerConnectionState: connectionState, iceConnectionState: "new" });
      },
      onDataMessage: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          dispatch({ type: "chat-added", entry: { ...parsed, delivery: "received" } });
        } catch {
          // ignore malformed chat messages
        }
      },
      onLog: (message) => {
        loggerRef.current.append("peer", message);
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
      await peerRef.current?.applyIceCandidate(message.candidate);
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
    dispatch({ type: "streams-updated", streams: { localCamera: createStreamFromTrack(track) } });
    await peerRef.current?.setCameraTrack(track);
  }, [dispatch, state.localMedia.selectedCameraId]);

  const toggleCamera = useCallback(async () => {
    if (state.localMedia.cameraOn) {
      mediaRef.current.setCameraEnabled(false);
      dispatch({ type: "local-media", media: { cameraOn: false } });
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: state.localMedia.micOn, cameraOn: false, screenSharing: state.localMedia.screenSharing },
      });
      return;
    }
    await startCamera();
    sendSignal({
      ...createMessageBase(),
      type: "media-state",
      media: { micOn: state.localMedia.micOn, cameraOn: true, screenSharing: state.localMedia.screenSharing },
    });
  }, [dispatch, startCamera, state.localMedia.cameraOn, state.localMedia.micOn, state.localMedia.screenSharing, sendSignal, createMessageBase]);

  const startMicrophone = useCallback(async () => {
    const track = await mediaRef.current.startMicrophone(state.localMedia.selectedMicrophoneId || undefined);
    dispatch({ type: "local-media", media: { micOn: true } });
    await peerRef.current?.setMicrophoneTrack(track);
  }, [dispatch, state.localMedia.selectedMicrophoneId]);

  const toggleMicrophone = useCallback(async () => {
    if (state.localMedia.micOn) {
      mediaRef.current.setMicrophoneEnabled(false);
      dispatch({ type: "local-media", media: { micOn: false } });
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: false, cameraOn: state.localMedia.cameraOn, screenSharing: state.localMedia.screenSharing },
      });
      return;
    }
    await startMicrophone();
    sendSignal({
      ...createMessageBase(),
      type: "media-state",
      media: { micOn: true, cameraOn: state.localMedia.cameraOn, screenSharing: state.localMedia.screenSharing },
    });
  }, [dispatch, startMicrophone, state.localMedia.micOn, state.localMedia.cameraOn, state.localMedia.screenSharing, sendSignal, createMessageBase]);

  const toggleScreenShare = useCallback(async () => {
    if (state.localMedia.screenSharing) {
      mediaRef.current.stopScreenShare();
      await peerRef.current?.setScreenTrack(null);
      dispatch({ type: "local-media", media: { screenSharing: false } });
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: state.localMedia.micOn, cameraOn: state.localMedia.cameraOn, screenSharing: false },
      });
      return;
    }
    const track = await mediaRef.current.startScreenShare(() => {
      void peerRef.current?.setScreenTrack(null);
      dispatch({ type: "local-media", media: { screenSharing: false } });
    });
    await peerRef.current?.setScreenTrack(track);
    dispatch({ type: "local-media", media: { screenSharing: true } });
    sendSignal({
      ...createMessageBase(),
      type: "media-state",
      media: { micOn: state.localMedia.micOn, cameraOn: state.localMedia.cameraOn, screenSharing: true },
    });
  }, [dispatch, state.localMedia.screenSharing, state.localMedia.micOn, state.localMedia.cameraOn, sendSignal, createMessageBase]);

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
    refreshDevices,
  }), [join, leave, sendChat, state, toggleCamera, toggleMicrophone, toggleScreenShare, refreshDevices]);
}
