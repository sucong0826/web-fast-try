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
