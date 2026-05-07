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
  onRemoteTrack: (event: RTCTrackEvent) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onDataMessage: (message: string) => void;
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

  constructor(options: PeerConnectionEngineOptions) {
    this.options = options;
  }

  create(): void {
    const { role, iceServers } = this.options;

    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    // Add 3 transceivers: audio (microphone), video (camera), video (screen)
    const micTransceiver = pc.addTransceiver("audio", {
      direction: "sendrecv",
    });
    this.microphoneSender = micTransceiver.sender;

    const cameraTransceiver = pc.addTransceiver("video", {
      direction: "sendrecv",
    });
    this.cameraSender = cameraTransceiver.sender;

    const screenTransceiver = pc.addTransceiver("video", {
      direction: "sendrecv",
    });
    this.screenSender = screenTransceiver.sender;

    // Set up event handlers
    pc.onicecandidate = (event) => {
      this.options.onIceCandidate(event.candidate);
    };

    pc.ontrack = (event) => {
      this.options.onRemoteTrack(event);
    };

    pc.onconnectionstatechange = () => {
      this.options.onConnectionState(pc.connectionState);
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

    // Data channel setup
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
    await this.microphoneSender?.replaceTrack(track);
  }

  async setCameraTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.cameraSender?.replaceTrack(track);
  }

  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.screenSender?.replaceTrack(track);
  }

  async applyRemoteDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (!this.pc) return;

    const polite = this.options.role === "answerer";
    const { signalingState } = this.pc;

    if (description.type === "offer") {
      if (
        shouldIgnoreOffer({ polite, makingOffer: this.makingOffer, signalingState })
      ) {
        return;
      }

      await this.pc.setRemoteDescription(description);

      // Set local description (answer)
      await this.pc.setLocalDescription();

      if (this.pc.localDescription) {
        this.options.onLocalDescription(this.pc.localDescription.toJSON());
      }
    } else {
      // answer
      await this.pc.setRemoteDescription(description);
    }
  }

  async applyIceCandidate(
    candidate: RTCIceCandidateInit | null,
  ): Promise<void> {
    if (!this.pc || candidate === null) return;
    await this.pc.addIceCandidate(candidate);
  }

  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
  }
}
