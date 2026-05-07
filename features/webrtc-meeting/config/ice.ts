export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function parseIceServers(input?: string | null): RTCIceServer[] {
  if (!input?.trim()) return DEFAULT_ICE_SERVERS;

  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return DEFAULT_ICE_SERVERS;
    const servers = parsed.filter(
      (server): server is RTCIceServer =>
        !!server &&
        typeof server === "object" &&
        ("urls" in server) &&
        (typeof server.urls === "string" || Array.isArray(server.urls))
    );
    return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

export function getInitialIceServers(): RTCIceServer[] {
  return parseIceServers(process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS);
}
