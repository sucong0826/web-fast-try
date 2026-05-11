export interface ShouldIgnoreOfferOptions {
  polite: boolean;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
}

export function shouldIgnoreOffer({
  polite,
  makingOffer,
  signalingState,
}: ShouldIgnoreOfferOptions): boolean {
  return !polite && (makingOffer || signalingState !== "stable");
}

export interface PeerConnectionEngineOptions {
  role: "caller" | "answerer";
  iceServers: RTCIceServer[];
  onLocalDescription: (description: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit | null) => void;
  onRemoteTrack: (event: RTCTrackEvent, type: "camera" | "screen") => void;
  onRemoteAudioStream: (stream: MediaStream) => void;
  onConnectionState: (state: {
    peerConnectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
  }) => void;
  onDataMessage: (message: string) => void;
  onSendersReady: () => void;
  onLog: (message: string) => void;
}

export class PeerConnectionEngine {
  private readonly options: PeerConnectionEngineOptions;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private makingOffer = false;
  private microphoneSender: RTCRtpSender | null = null;
  private cameraSender: RTCRtpSender | null = null;
  private screenSender: RTCRtpSender | null = null;
  private screenTransceiver: RTCRtpTransceiver | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private pendingRemoteTracks: RTCTrackEvent[] = [];

  constructor(options: PeerConnectionEngineOptions) {
    this.options = options;
  }

  create(): void {
    const { role, iceServers } = this.options;

    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    // Only the caller creates transceivers. The answerer receives them via the
    // offer and initialises its senders in initAnswererSenders() after
    // setRemoteDescription. This prevents MID inflation caused by both sides
    // independently calling addTransceiver before any negotiation.
    if (role === "caller") {
      const micT = pc.addTransceiver("audio", { direction: "sendrecv" });
      this.microphoneSender = micT.sender;

      const camT = pc.addTransceiver("video", { direction: "sendrecv" });
      this.cameraSender = camT.sender;

      const screenT = pc.addTransceiver("video", { direction: "sendrecv" });
      this.screenSender = screenT.sender;
      this.screenTransceiver = screenT;
    }

    pc.onicecandidate = (event) => {
      this.options.onIceCandidate(event.candidate);
    };

    pc.ontrack = (event) => {
      this.options.onLog(`ontrack: kind=${event.track.kind} mid=${event.transceiver.mid} screenT=${!!this.screenTransceiver}`);
      if (event.track.kind === "audio") {
        // Chrome auto-plays received WebRTC audio without a DOM element; Safari does not.
        // Always pipe the remote audio into an Audio object to ensure cross-browser playback.
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        this.options.onRemoteAudioStream(stream);
        return;
      }
      // For the answerer, screenTransceiver is null until initAnswererSenders() runs (which happens
      // synchronously right after setRemoteDescription). Queue the event so we route after the
      // screen transceiver reference is known.
      if (this.screenTransceiver === null) {
        this.pendingRemoteTracks.push(event);
        return;
      }
      const type: "camera" | "screen" =
        event.transceiver === this.screenTransceiver ? "screen" : "camera";
      this.options.onRemoteTrack(event, type);
    };

    pc.onconnectionstatechange = () => {
      this.emitConnectionState();
    };
    pc.oniceconnectionstatechange = () => {
      this.emitConnectionState();
    };

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.options.onLocalDescription(pc.localDescription.toJSON());
        }
      } catch (err) {
        this.options.onLog(`negotiation error: ${err}`);
      } finally {
        this.makingOffer = false;
      }
    };

    if (role === "caller") {
      const channel = pc.createDataChannel("chat");
      this.dataChannel = channel;
      this.setupDataChannel(channel);
    } else {
      pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(event.channel);
      };
    }
  }

  private initAnswererSenders(): void {
    if (!this.pc || this.microphoneSender) return;
    const transceivers = this.getTransceivers(this.pc);
    if (transceivers.length === 0) {
      this.options.onLog("answerer senders unavailable: getTransceivers not supported");
      this.options.onSendersReady();
      return;
    }
    const audioT = transceivers.find((t) => t.receiver.track.kind === "audio") ?? null;
    const videoTs = transceivers.filter((t) => t.receiver.track.kind === "video");

    // Chrome creates transceivers from setRemoteDescription(offer) with direction=recvonly
    // (per JSEP spec §5.3.1). Without overriding to sendrecv here, setLocalDescription()
    // produces an answer with a=recvonly, so the caller's ontrack never fires.
    if (audioT) audioT.direction = "sendrecv";
    videoTs.forEach((t) => (t.direction = "sendrecv"));

    this.microphoneSender = audioT?.sender ?? null;
    this.cameraSender = videoTs[0]?.sender ?? null;
    this.screenSender = videoTs[1]?.sender ?? null;
    this.screenTransceiver = videoTs[1] ?? null;

    // Drain any video ontrack events that arrived before screenTransceiver was known
    const pending = this.pendingRemoteTracks.splice(0);
    for (const event of pending) {
      const type: "camera" | "screen" =
        event.transceiver === this.screenTransceiver ? "screen" : "camera";
      this.options.onRemoteTrack(event, type);
    }

    this.options.onLog(
      `answerer senders ready — mic=${!!this.microphoneSender} cam=${!!this.cameraSender} screen=${!!this.screenSender}`,
    );
    this.options.onSendersReady();
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => {
      this.options.onDataMessage(event.data);
    };
    channel.onopen = () => {
      this.options.onLog("data channel open");
    };
    channel.onclose = () => {
      this.options.onLog("data channel closed");
    };
    channel.onerror = (event) => {
      this.options.onLog(`data channel error: ${event}`);
    };
  }

  sendDataMessage(message: string): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      return false;
    }
    this.dataChannel.send(message);
    return true;
  }

  async setMicrophoneTrack(track: MediaStreamTrack | null): Promise<void> {
    this.options.onLog(
      `setMicrophoneTrack: id=${this.trackId(track)} senderReady=${!!this.microphoneSender}`,
    );
    await this.microphoneSender?.replaceTrack(track);
  }

  async setCameraTrack(track: MediaStreamTrack | null): Promise<void> {
    this.options.onLog(
      `setCameraTrack: id=${this.trackId(track)} senderReady=${!!this.cameraSender}`,
    );
    await this.cameraSender?.replaceTrack(track);
  }

  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    this.options.onLog(
      `setScreenTrack: id=${this.trackId(track)} senderReady=${!!this.screenSender}`,
    );
    await this.screenSender?.replaceTrack(track);
  }

  async applyRemoteDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (!this.pc) return;

    const polite = this.options.role === "answerer";
    const { signalingState } = this.pc;

    if (description.type === "offer") {
      if (shouldIgnoreOffer({ polite, makingOffer: this.makingOffer, signalingState })) {
        return;
      }

      await this.pc.setRemoteDescription(description);

      // Answerer: extract senders from the offer's transceivers now that they exist
      if (polite) this.initAnswererSenders();

      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.options.onLocalDescription(this.pc.localDescription.toJSON());
      }
    } else {
      this.options.onLog(`applyRemoteDescription(answer) signalingState=${this.pc.signalingState}`);
      await this.pc.setRemoteDescription(description);
      this.options.onLog(
        `setRemoteDescription(answer) done, transceivers=${this.getTransceivers(this.pc).length}`,
      );
    }

    await this.drainPendingCandidates();
  }

  private async drainPendingCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.pc?.addIceCandidate(candidate);
      } catch (err) {
        this.options.onLog(`addIceCandidate (drained): ${err}`);
      }
    }
  }

  async applyIceCandidate(
    candidate: RTCIceCandidateInit | null,
  ): Promise<void> {
    if (!this.pc || candidate === null) return;
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate);
  }

  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
    this.microphoneSender = null;
    this.cameraSender = null;
    this.screenSender = null;
    this.screenTransceiver = null;
  }

  private emitConnectionState(): void {
    if (!this.pc) return;
    this.options.onConnectionState({
      peerConnectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
    });
  }

  private getTransceivers(pc: RTCPeerConnection): RTCRtpTransceiver[] {
    return typeof pc.getTransceivers === "function" ? pc.getTransceivers() : [];
  }

  private trackId(track: MediaStreamTrack | null): string {
    const id = track?.id;
    return typeof id === "string" ? id.slice(0, 8) : "null";
  }
}
