import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamFromTrack, stopStream } from "./mediaStreams";

describe("media stream helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a MediaStream with the provided track", () => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    const track = new FakeMediaStreamTrack("audio");

    const stream = createStreamFromTrack(track.asMediaStreamTrack());

    expect(stream.getTracks()).toEqual([track]);
  });

  it("creates an empty MediaStream when no track is provided", () => {
    vi.stubGlobal("MediaStream", FakeMediaStream);

    const stream = createStreamFromTrack(null);

    expect(stream.getTracks()).toEqual([]);
  });

  it("stops every track in a stream", () => {
    const audioTrack = new FakeMediaStreamTrack("audio");
    const videoTrack = new FakeMediaStreamTrack("video");
    const stream = new FakeMediaStream([
      audioTrack.asMediaStreamTrack(),
      videoTrack.asMediaStreamTrack(),
    ]);

    stopStream(stream.asMediaStream());
    stopStream(null);

    expect(audioTrack.stopped).toBe(true);
    expect(videoTrack.stopped).toBe(true);
  });
});

class FakeMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }

  getTracks() {
    return [...this.tracks];
  }

  asMediaStream() {
    return this as unknown as MediaStream;
  }
}

class FakeMediaStreamTrack {
  readonly kind: MediaStreamTrack["kind"];
  enabled = true;
  stopped = false;

  constructor(kind: MediaStreamTrack["kind"]) {
    this.kind = kind;
  }

  stop() {
    this.stopped = true;
  }

  asMediaStreamTrack() {
    return this as unknown as MediaStreamTrack;
  }
}
