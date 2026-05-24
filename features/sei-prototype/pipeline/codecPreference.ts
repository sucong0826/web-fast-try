const KEEP_ALONGSIDE_H264 = new Set(["video/rtx", "video/red", "video/ulpfec"]);

export function pickH264Codecs(codecs: RTCRtpCodec[]): RTCRtpCodec[] {
  const hasH264 = codecs.some((c) => c.mimeType.toLowerCase() === "video/h264");
  if (!hasH264) return [];
  return codecs.filter((c) => {
    const mt = c.mimeType.toLowerCase();
    return mt === "video/h264" || KEEP_ALONGSIDE_H264.has(c.mimeType.toLowerCase());
  });
}
