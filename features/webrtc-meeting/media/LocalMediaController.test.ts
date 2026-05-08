import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMediaController } from "./LocalMediaController";

describe("LocalMediaController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enumerates cameras and microphones", async () => {
    const camera = mediaDevice("videoinput", "camera-1");
    const microphone = mediaDevice("audioinput", "mic-1");
    installMediaDevices({
      enumerateDevices: async () => [
        camera,
        microphone,
        mediaDevice("audiooutput", "speaker-1"),
      ],
    });

    const devices = await new LocalMediaController().enumerateDevices();

    expect(devices).toEqual({
      cameras: [camera],
      microphones: [microphone],
    });
  });

  it("starts microphones with capture constraints and stops the previous track", async () => {
    const firstTrack = new FakeMediaStreamTrack("audio");
    const secondTrack = new FakeMediaStreamTrack("audio");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(streamWithTracks(firstTrack))
      .mockResolvedValueOnce(streamWithTracks(secondTrack));
    installMediaDevices({ getUserMedia });
    const controller = new LocalMediaController();

    await controller.startMicrophone("mic-1");
    const track = await controller.startMicrophone("mic-2");
    controller.setMicrophoneEnabled(false);

    expect(firstTrack.stopped).toBe(true);
    expect(track).toBe(secondTrack);
    expect(secondTrack.enabled).toBe(false);
    expect(controller.getSnapshot().microphoneTrack).toBe(secondTrack);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: {
        deviceId: { exact: "mic-2" },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  });

  it("starts cameras with capture constraints and stops the previous track", async () => {
    const firstTrack = new FakeMediaStreamTrack("video");
    const secondTrack = new FakeMediaStreamTrack("video");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(streamWithTracks(firstTrack))
      .mockResolvedValueOnce(streamWithTracks(secondTrack));
    installMediaDevices({ getUserMedia });
    const controller = new LocalMediaController();

    await controller.startCamera("camera-1");
    const track = await controller.startCamera("camera-2");
    controller.setCameraEnabled(false);

    expect(firstTrack.stopped).toBe(true);
    expect(track).toBe(secondTrack);
    expect(secondTrack.enabled).toBe(false);
    expect(controller.getSnapshot().cameraTrack).toBe(secondTrack);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: {
        deviceId: { exact: "camera-2" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  });

  it("starts screen share, stops the previous screen track, and listens for ended once", async () => {
    const firstTrack = new FakeMediaStreamTrack("video");
    const secondTrack = new FakeMediaStreamTrack("video");
    const getDisplayMedia = vi
      .fn()
      .mockResolvedValueOnce(streamWithTracks(firstTrack))
      .mockResolvedValueOnce(streamWithTracks(secondTrack));
    const onEnded = vi.fn();
    installMediaDevices({ getDisplayMedia });
    const controller = new LocalMediaController();

    await controller.startScreenShare(onEnded);
    const track = await controller.startScreenShare(onEnded);
    secondTrack.dispatchEnded();
    secondTrack.dispatchEnded();

    expect(firstTrack.stopped).toBe(true);
    expect(track).toBe(secondTrack);
    expect(controller.getSnapshot().screenTrack).toBe(secondTrack);
    expect(getDisplayMedia).toHaveBeenLastCalledWith({
      video: true,
      audio: false,
    });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("stops and clears screen sharing", async () => {
    const screenTrack = new FakeMediaStreamTrack("video");
    installMediaDevices({
      getDisplayMedia: async () => streamWithTracks(screenTrack),
    });
    const controller = new LocalMediaController();

    await controller.startScreenShare(() => {});
    controller.stopScreenShare();

    expect(screenTrack.stopped).toBe(true);
    expect(controller.getSnapshot().screenTrack).toBeNull();
  });

  it("stops and clears all current tracks", async () => {
    const microphoneTrack = new FakeMediaStreamTrack("audio");
    const cameraTrack = new FakeMediaStreamTrack("video");
    const screenTrack = new FakeMediaStreamTrack("video");
    installMediaDevices({
      getUserMedia: vi
        .fn()
        .mockResolvedValueOnce(streamWithTracks(microphoneTrack))
        .mockResolvedValueOnce(streamWithTracks(cameraTrack)),
      getDisplayMedia: async () => streamWithTracks(screenTrack),
    });
    const controller = new LocalMediaController();

    await controller.startMicrophone();
    await controller.startCamera();
    await controller.startScreenShare(() => {});
    controller.stopAll();

    expect(microphoneTrack.stopped).toBe(true);
    expect(cameraTrack.stopped).toBe(true);
    expect(screenTrack.stopped).toBe(true);
    expect(controller.getSnapshot()).toEqual({
      microphoneTrack: null,
      cameraTrack: null,
      screenTrack: null,
    });
  });

  it("throws descriptive errors when capture creates no matching track", async () => {
    installMediaDevices({
      getUserMedia: vi
        .fn()
        .mockResolvedValueOnce(streamWithTracks())
        .mockResolvedValueOnce(streamWithTracks()),
      getDisplayMedia: async () => streamWithTracks(),
    });
    const controller = new LocalMediaController();

    await expect(controller.startMicrophone()).rejects.toThrow(
      "No microphone track was created.",
    );
    await expect(controller.startCamera()).rejects.toThrow(
      "No camera track was created.",
    );
    await expect(controller.startScreenShare(() => {})).rejects.toThrow(
      "No screen-share track was created.",
    );
  });

  it("throws when screen sharing is unsupported", async () => {
    installMediaDevices({});

    await expect(
      new LocalMediaController().startScreenShare(() => {}),
    ).rejects.toThrow("Screen sharing is not supported in this browser.");
  });
});

function installMediaDevices(mediaDevices: Partial<MediaDevices>) {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => [],
      ...mediaDevices,
    },
  });
}

function mediaDevice(
  kind: MediaDeviceInfo["kind"],
  deviceId: string,
): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    groupId: "group",
    label: deviceId,
    toJSON: () => ({}),
  };
}

function streamWithTracks(
  ...tracks: FakeMediaStreamTrack[]
): MediaStream {
  return new FakeMediaStream(
    tracks.map((track) => track.asMediaStreamTrack()),
  ).asMediaStream();
}

type EndedListener = {
  listener: () => void;
  once: boolean;
};

class FakeMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }

  asMediaStream() {
    return this as unknown as MediaStream;
  }
}

class FakeMediaStreamTrack {
  readonly kind: MediaStreamTrack["kind"];
  enabled = true;
  stopped = false;
  private endedListeners: EndedListener[] = [];

  constructor(kind: MediaStreamTrack["kind"]) {
    this.kind = kind;
  }

  stop() {
    this.stopped = true;
  }

  addEventListener(
    type: string,
    listener: () => void,
    options?: AddEventListenerOptions,
  ) {
    if (type !== "ended") return;
    this.endedListeners.push({ listener, once: options?.once ?? false });
  }

  dispatchEnded() {
    const listeners = [...this.endedListeners];
    this.endedListeners = this.endedListeners.filter(({ once }) => !once);
    listeners.forEach(({ listener }) => listener());
  }

  asMediaStreamTrack() {
    return this as unknown as MediaStreamTrack;
  }
}
