import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerConnectionEngine, shouldIgnoreOffer } from "./PeerConnectionEngine";

describe("perfect negotiation helpers", () => {
  it("impolite participant ignores offer collision", () => {
    expect(
      shouldIgnoreOffer({
        polite: false,
        makingOffer: true,
        signalingState: "have-local-offer",
      }),
    ).toBe(true);
  });

  it("polite participant accepts offer collision", () => {
    expect(
      shouldIgnoreOffer({
        polite: true,
        makingOffer: true,
        signalingState: "have-local-offer",
      }),
    ).toBe(false);
  });
});

describe("PeerConnectionEngine", () => {
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;

  afterEach(() => {
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
  });

  it("caller creates the chat data channel", () => {
    const peerConnections: FakePeerConnection[] = [];
    installFakePeerConnection(peerConnections);
    const engine = new PeerConnectionEngine(createOptions({ role: "caller" }));

    engine.create();

    expect(peerConnections[0].createdDataChannels).toHaveLength(1);
    expect(peerConnections[0].createdDataChannels[0].label).toBe("chat");
  });

  it("answerer accepts an incoming chat data channel", () => {
    const peerConnections: FakePeerConnection[] = [];
    const onDataMessage = vi.fn();
    installFakePeerConnection(peerConnections);
    const engine = new PeerConnectionEngine(
      createOptions({ role: "answerer", onDataMessage }),
    );

    engine.create();
    const channel = new FakeDataChannel("chat");
    peerConnections[0].receiveDataChannel(channel);
    channel.receive("hello");

    expect(onDataMessage).toHaveBeenCalledWith("hello");
  });

  it("sends data messages only when the channel is open", () => {
    const peerConnections: FakePeerConnection[] = [];
    installFakePeerConnection(peerConnections);
    const engine = new PeerConnectionEngine(createOptions({ role: "caller" }));
    engine.create();
    const channel = peerConnections[0].createdDataChannels[0];

    expect(engine.sendDataMessage("before-open")).toBe(false);

    channel.readyState = "open";

    expect(engine.sendDataMessage("after-open")).toBe(true);
    expect(channel.sentMessages).toEqual(["after-open"]);
  });

  it("replaces media tracks through stored senders", async () => {
    const peerConnections: FakePeerConnection[] = [];
    installFakePeerConnection(peerConnections);
    const engine = new PeerConnectionEngine(createOptions({ role: "caller" }));
    engine.create();
    const [microphoneSender, cameraSender, screenSender] =
      peerConnections[0].senders;
    const microphoneTrack = fakeTrack("audio");
    const cameraTrack = fakeTrack("video");
    const screenTrack = fakeTrack("video");

    await engine.setMicrophoneTrack(microphoneTrack);
    await engine.setCameraTrack(cameraTrack);
    await engine.setScreenTrack(screenTrack);

    expect(microphoneSender.replaceTrack).toHaveBeenCalledWith(microphoneTrack);
    expect(cameraSender.replaceTrack).toHaveBeenCalledWith(cameraTrack);
    expect(screenSender.replaceTrack).toHaveBeenCalledWith(screenTrack);
  });

  it("ignores impolite colliding offers without setting the remote description", async () => {
    const peerConnections: FakePeerConnection[] = [];
    installFakePeerConnection(peerConnections);
    const engine = new PeerConnectionEngine(createOptions({ role: "caller" }));
    engine.create();
    peerConnections[0].signalingState = "have-local-offer";

    await engine.applyRemoteDescription({ type: "offer", sdp: "remote-offer" });

    expect(peerConnections[0].setRemoteDescription).not.toHaveBeenCalled();
  });

  it("answerer accepts a remote offer and emits a local answer", async () => {
    const peerConnections: FakePeerConnection[] = [];
    const onLocalDescription = vi.fn();
    installFakePeerConnection(peerConnections);
    const engine = new PeerConnectionEngine(
      createOptions({ role: "answerer", onLocalDescription }),
    );
    engine.create();
    peerConnections[0].signalingState = "have-local-offer";

    await engine.applyRemoteDescription({ type: "offer", sdp: "remote-offer" });

    expect(peerConnections[0].setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "remote-offer",
    });
    expect(onLocalDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "local-answer",
    });
  });
});

function installFakePeerConnection(peerConnections: FakePeerConnection[]) {
  globalThis.RTCPeerConnection = class extends FakePeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      peerConnections.push(this);
    }
  } as unknown as typeof RTCPeerConnection;
}

function createOptions(
  overrides: Partial<
    ConstructorParameters<typeof PeerConnectionEngine>[0]
  > = {},
): ConstructorParameters<typeof PeerConnectionEngine>[0] {
  return {
    role: "caller",
    iceServers: [{ urls: "stun:example.test" }],
    onLocalDescription: vi.fn(),
    onIceCandidate: vi.fn(),
    onRemoteTrack: vi.fn(),
    onRemoteAudioStream: vi.fn(),
    onConnectionState: vi.fn(),
    onDataMessage: vi.fn(),
    onSendersReady: vi.fn(),
    onLog: vi.fn(),
    ...overrides,
  };
}

function fakeTrack(kind: MediaStreamTrack["kind"]): MediaStreamTrack {
  return { kind } as MediaStreamTrack;
}

class FakePeerConnection {
  readonly configuration?: RTCConfiguration;
  readonly senders: FakeSender[] = [];
  readonly createdDataChannels: FakeDataChannel[] = [];
  localDescription: RTCSessionDescription | null = null;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  onicecandidate: RTCPeerConnection["onicecandidate"] = null;
  ontrack: RTCPeerConnection["ontrack"] = null;
  onconnectionstatechange: RTCPeerConnection["onconnectionstatechange"] = null;
  oniceconnectionstatechange: RTCPeerConnection["oniceconnectionstatechange"] =
    null;
  onnegotiationneeded: RTCPeerConnection["onnegotiationneeded"] = null;
  ondatachannel: RTCPeerConnection["ondatachannel"] = null;
  setRemoteDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      if (description.type === "offer") {
        this.signalingState = "have-remote-offer";
      }
    },
  );
  addIceCandidate = vi.fn(async () => {});
  close = vi.fn();

  constructor(configuration?: RTCConfiguration) {
    this.configuration = configuration;
  }

  addTransceiver() {
    const sender = new FakeSender();
    this.senders.push(sender);
    return { sender };
  }

  createDataChannel(label: string) {
    const channel = new FakeDataChannel(label);
    this.createdDataChannels.push(channel);
    return channel;
  }

  async setLocalDescription() {
    const type =
      this.signalingState === "have-remote-offer" ? "answer" : "offer";
    this.localDescription = new FakeSessionDescription({
      type,
      sdp: type === "answer" ? "local-answer" : "local-offer",
    }) as unknown as RTCSessionDescription;
    this.signalingState = type === "answer" ? "stable" : "have-local-offer";
  }

  receiveDataChannel(channel: FakeDataChannel) {
    this.ondatachannel?.({ channel } as RTCDataChannelEvent);
  }
}

class FakeSender {
  replaceTrack = vi.fn(async () => {});
}

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sentMessages: string[] = [];
  onmessage: RTCDataChannel["onmessage"] = null;
  onopen: RTCDataChannel["onopen"] = null;
  onclose: RTCDataChannel["onclose"] = null;
  onerror: RTCDataChannel["onerror"] = null;

  constructor(readonly label: string) {}

  send(message: string) {
    this.sentMessages.push(message);
  }

  close() {
    this.readyState = "closed";
  }

  receive(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class FakeSessionDescription {
  constructor(private readonly description: RTCSessionDescriptionInit) {}

  toJSON() {
    return this.description;
  }
}
