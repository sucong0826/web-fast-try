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
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localMediaRef = useRef(state.localMedia);
  localMediaRef.current = state.localMedia;
  const roomIdRef = useRef(state.roomId);
  roomIdRef.current = state.roomId;

  const publishLogs = useCallback(() => {
    dispatch({ type: "logs-updated", logs: loggerRef.current.getEvents() });
  }, [dispatch]);

  const sendSignal = useCallback((message: SignalMessage) => {
    loggerRef.current.append("signaling", `send ${message.type}`, message);
    publishLogs();
    try {
      signalingRef.current?.send(message);
    } catch (err) {
      loggerRef.current.append("signaling", `send failed: ${message.type}`, err);
      publishLogs();
    }
  }, [publishLogs]);

  const createMessageBase = useCallback(() => ({
    roomId: roomIdRef.current,
    participantId: participantIdRef.current,
    messageId: createClientMessageId(),
    sentAt: Date.now(),
  }), []);

  const ensurePeer = useCallback((role: "caller" | "answerer", iceInput?: string) => {
    if (peerRef.current) {
      loggerRef.current.append("peer", `ensurePeer(${role}) — reusing existing engine`);
      publishLogs();
      return peerRef.current;
    }
    loggerRef.current.append("peer", `ensurePeer(${role}) — creating new PeerConnectionEngine`);
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
      onRemoteTrack: (event, type) => {
        const mid = event.transceiver.mid;
        loggerRef.current.append("peer", `remote track type=${type} mid=${mid}`);
        publishLogs();
        const stream = event.streams[0] || createStreamFromTrack(event.track);
        dispatch({
          type: "streams-updated",
          streams: type === "screen" ? { remoteScreen: stream } : { remoteCamera: stream },
        });
      },
      onRemoteAudioStream: (stream) => {
        loggerRef.current.append("peer", "remote audio stream — attaching to audio element");
        publishLogs();
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch((e) => {
          loggerRef.current.append("peer", `remote audio play() failed: ${e}`);
          publishLogs();
        });
      },
      onSendersReady: () => {
        const { microphoneTrack, cameraTrack, screenTrack } = mediaRef.current.getSnapshot();
        if (microphoneTrack) {
          loggerRef.current.append("peer", "seeding microphoneTrack (answerer)");
          void engine.setMicrophoneTrack(microphoneTrack);
        }
        if (cameraTrack) {
          loggerRef.current.append("peer", "seeding cameraTrack (answerer)");
          void engine.setCameraTrack(cameraTrack);
        }
        if (screenTrack) {
          loggerRef.current.append("peer", "seeding screenTrack (answerer)");
          void engine.setScreenTrack(screenTrack);
        }
        publishLogs();
      },
      onConnectionState: (connectionState) => {
        dispatch({
          type: "connection-state-changed",
          peerConnectionState: connectionState.peerConnectionState,
          iceConnectionState: connectionState.iceConnectionState,
        });
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

    // Caller senders are created in create() so tracks can be seeded immediately.
    // Answerer senders don't exist until initAnswererSenders() runs — seeding happens in onSendersReady.
    if (role === "caller") {
      const { microphoneTrack, cameraTrack, screenTrack } = mediaRef.current.getSnapshot();
      if (microphoneTrack) {
        loggerRef.current.append("peer", "seeding existing microphoneTrack into new engine");
        void engine.setMicrophoneTrack(microphoneTrack);
      }
      if (cameraTrack) {
        loggerRef.current.append("peer", "seeding existing cameraTrack into new engine");
        void engine.setCameraTrack(cameraTrack);
      }
      if (screenTrack) {
        loggerRef.current.append("peer", "seeding existing screenTrack into new engine");
        void engine.setScreenTrack(screenTrack);
      }
      publishLogs();
    }

    return engine;
  }, [createMessageBase, dispatch, publishLogs, sendSignal]);

  // Keep a ref to the latest handleSignal so the SignalingClient's onMessage closure
  // always calls the current version rather than a stale one captured at join() time.
  const handleSignalRef = useRef<((message: SignalMessage) => Promise<void>) | null>(null);

  const handleSignal = useCallback(async (message: SignalMessage) => {
    loggerRef.current.append("signaling", `recv ${message.type}`, message);
    publishLogs();

    if (message.type === "room-snapshot") {
      loggerRef.current.append("signaling",
        `joined as ${message.self.role}, peer=${message.peer?.participantId?.slice(0, 8) ?? "none"}`);
      publishLogs();
      dispatch({
        type: "joined-room",
        roomId: message.roomId,
        participantId: participantIdRef.current,
        displayName: state.displayName,
        role: message.self.role,
        peer: message.peer,
      });
      if (message.peer) {
        loggerRef.current.append("signaling", `peer already in room — ensurePeer(${message.self.role})`);
        publishLogs();
        ensurePeer(message.self.role);
      }
      return;
    }

    if (message.type === "peer-joined") {
      const myRole = state.localParticipant?.role || "caller";
      loggerRef.current.append("signaling",
        `peer-joined: ${message.peer.participantId.slice(0, 8)} — my role=${myRole}, sending media-state`);
      publishLogs();
      dispatch({ type: "peer-joined", peer: message.peer });
      ensurePeer(myRole);
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: {
          micOn: localMediaRef.current.micOn,
          cameraOn: localMediaRef.current.cameraOn,
          screenSharing: localMediaRef.current.screenSharing,
        },
      });
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

    if (message.type === "room-full") {
      dispatch({ type: "error", error: message.message });
      return;
    }

    if (message.type === "error") {
      if (message.code === "peer-not-available") {
        loggerRef.current.append("signaling", `non-fatal: ${message.message}`);
        publishLogs();
      } else {
        dispatch({ type: "error", error: message.message });
      }
    }
  }, [dispatch, ensurePeer, publishLogs, state.displayName, state.localParticipant?.role]);

  handleSignalRef.current = handleSignal;

  const join = useCallback(async (input: {
    roomId: string;
    displayName: string;
    signalingUrl: string;
    iceServersInput?: string;
  }) => {
    // Clean up any leftover state from a previous session before starting fresh.
    peerRef.current?.close();
    peerRef.current = null;
    signalingRef.current?.close();
    signalingRef.current = null;

    const roomId = normalizeRoomId(input.roomId);
    const displayName = input.displayName.trim() || "Guest";
    dispatch({ type: "set-joining", roomId, participantId: participantIdRef.current, displayName });

    const signaling = new SignalingClient({
      url: input.signalingUrl,
      onMessage: (message) => void handleSignalRef.current?.(message),
      onStateChange: (websocketState) => dispatch({ type: "websocket-state", websocketState }),
      onError: (error) => dispatch({ type: "error", error }),
    });
    signalingRef.current = signaling;
    await signaling.connect();
    signaling.join(createJoinRoomMessage({ roomId, participantId: participantIdRef.current, displayName }));
  }, [dispatch]);

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
      if (state.remoteParticipant) {
        sendSignal({
          ...createMessageBase(),
          type: "media-state",
          media: { micOn: state.localMedia.micOn, cameraOn: false, screenSharing: state.localMedia.screenSharing },
        });
      }
      return;
    }
    await startCamera();
    if (state.remoteParticipant) {
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: state.localMedia.micOn, cameraOn: true, screenSharing: state.localMedia.screenSharing },
      });
    }
  }, [dispatch, startCamera, state.localMedia.cameraOn, state.localMedia.micOn, state.localMedia.screenSharing, state.remoteParticipant, sendSignal, createMessageBase]);

  const startMicrophone = useCallback(async () => {
    const track = await mediaRef.current.startMicrophone(state.localMedia.selectedMicrophoneId || undefined);
    dispatch({ type: "local-media", media: { micOn: true } });
    await peerRef.current?.setMicrophoneTrack(track);
  }, [dispatch, state.localMedia.selectedMicrophoneId]);

  const toggleMicrophone = useCallback(async () => {
    if (state.localMedia.micOn) {
      mediaRef.current.setMicrophoneEnabled(false);
      dispatch({ type: "local-media", media: { micOn: false } });
      if (state.remoteParticipant) {
        sendSignal({
          ...createMessageBase(),
          type: "media-state",
          media: { micOn: false, cameraOn: state.localMedia.cameraOn, screenSharing: state.localMedia.screenSharing },
        });
      }
      return;
    }
    await startMicrophone();
    if (state.remoteParticipant) {
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: true, cameraOn: state.localMedia.cameraOn, screenSharing: state.localMedia.screenSharing },
      });
    }
  }, [dispatch, startMicrophone, state.localMedia.micOn, state.localMedia.cameraOn, state.localMedia.screenSharing, state.remoteParticipant, sendSignal, createMessageBase]);

  const toggleScreenShare = useCallback(async () => {
    if (state.localMedia.screenSharing) {
      mediaRef.current.stopScreenShare();
      await peerRef.current?.setScreenTrack(null);
      dispatch({ type: "local-media", media: { screenSharing: false } });
      if (state.remoteParticipant) {
        sendSignal({
          ...createMessageBase(),
          type: "media-state",
          media: { micOn: state.localMedia.micOn, cameraOn: state.localMedia.cameraOn, screenSharing: false },
        });
      }
      return;
    }
    const track = await mediaRef.current.startScreenShare(() => {
      // Fired when the user clicks "Stop sharing" in the browser's own UI.
      // Must mirror the same cleanup as the explicit stop path in toggleScreenShare.
      void peerRef.current?.setScreenTrack(null);
      dispatch({ type: "local-media", media: { screenSharing: false } });
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: localMediaRef.current.micOn, cameraOn: localMediaRef.current.cameraOn, screenSharing: false },
      });
    });
    await peerRef.current?.setScreenTrack(track);
    dispatch({ type: "local-media", media: { screenSharing: true } });
    if (state.remoteParticipant) {
      sendSignal({
        ...createMessageBase(),
        type: "media-state",
        media: { micOn: state.localMedia.micOn, cameraOn: state.localMedia.cameraOn, screenSharing: true },
      });
    }
  }, [dispatch, state.localMedia.screenSharing, state.localMedia.micOn, state.localMedia.cameraOn, state.remoteParticipant, sendSignal, createMessageBase]);

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

  const changeCamera = useCallback(async (deviceId: string) => {
    dispatch({ type: "local-media", media: { selectedCameraId: deviceId } });
    if (state.localMedia.cameraOn) {
      const track = await mediaRef.current.startCamera(deviceId || undefined);
      dispatch({ type: "streams-updated", streams: { localCamera: createStreamFromTrack(track) } });
      await peerRef.current?.setCameraTrack(track);
    }
  }, [dispatch, state.localMedia.cameraOn]);

  const changeMicrophone = useCallback(async (deviceId: string) => {
    dispatch({ type: "local-media", media: { selectedMicrophoneId: deviceId } });
    if (state.localMedia.micOn) {
      const track = await mediaRef.current.startMicrophone(deviceId || undefined);
      await peerRef.current?.setMicrophoneTrack(track);
    }
  }, [dispatch, state.localMedia.micOn]);

  const leave = useCallback(() => {
    mediaRef.current.stopAll();
    statsRef.current?.stop();
    peerRef.current?.close();
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
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
    changeCamera,
    changeMicrophone,
  }), [join, leave, sendChat, state, toggleCamera, toggleMicrophone, toggleScreenShare, refreshDevices, changeCamera, changeMicrophone]);
}
