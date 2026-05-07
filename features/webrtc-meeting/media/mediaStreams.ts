export function createStreamFromTrack(track: MediaStreamTrack | null): MediaStream {
  const stream = new MediaStream();
  if (track) stream.addTrack(track);
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
