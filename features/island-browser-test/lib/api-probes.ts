// Verbatim port of the Web API capability checks from test.html (lines 542–681).

import type { ApiResult, RawSignals, Status, WebCodecsProbeResult } from "./types";

interface CodecConfigChecker {
  isConfigSupported: (
    cfg: unknown,
  ) => Promise<{ supported?: boolean; config?: Record<string, unknown> }>;
}

export function runSyncApiChecks(raw: RawSignals): ApiResult[] {
  const results: ApiResult[] = [];
  const add = (label: string, ok: boolean, detail = "", status: Status | null = null) => {
    results.push({
      label,
      status: status ?? (ok ? "pass" : "fail"),
      detail: detail || (ok ? "available" : "not available"),
    });
  };

  const G = globalThis as Record<string, unknown>;

  add(
    "OffscreenCanvas",
    typeof G.OffscreenCanvas === "function",
    typeof G.OffscreenCanvas === "function"
      ? "function"
      : "undefined — VB/sharing disabled",
  );
  add(
    "SharedArrayBuffer",
    typeof G.SharedArrayBuffer !== "undefined",
    typeof G.SharedArrayBuffer !== "undefined"
      ? "available" +
          (raw.crossOriginIsolated ? "" : " (NOT crossOriginIsolated!)")
      : "undefined — video share send disabled",
  );
  add(
    "crossOriginIsolated",
    raw.crossOriginIsolated,
    raw.crossOriginIsolated
      ? "true"
      : "false — required for SAB-backed features",
  );
  add("WebAssembly", typeof G.WebAssembly === "object", "");
  add(
    "WebGL2",
    typeof G.WebGL2RenderingContext === "function",
    typeof G.WebGL2RenderingContext === "function" ? "available" : "missing",
  );
  add("VideoEncoder", typeof G.VideoEncoder === "function", "");
  add("VideoDecoder", typeof G.VideoDecoder === "function", "");
  add(
    "AudioEncoder",
    typeof G.AudioEncoder === "function",
    typeof G.AudioEncoder === "function" ? "available" : "missing",
  );
  add(
    "AudioDecoder",
    typeof G.AudioDecoder === "function",
    typeof G.AudioDecoder === "function" ? "available" : "missing",
  );
  add(
    "MediaStreamTrackProcessor",
    typeof G.MediaStreamTrackProcessor === "function",
    "",
  );
  add(
    "MediaStreamTrackGenerator",
    typeof G.MediaStreamTrackGenerator === "function",
    "",
  );
  add(
    "RTCRtpScriptTransform",
    typeof G.RTCRtpScriptTransform === "function",
    "",
  );
  add("WebTransport", typeof G.WebTransport === "function", "");
  add(
    "WebGPU (navigator.gpu)",
    typeof (navigator as Navigator & { gpu?: unknown }).gpu === "object" &&
      (navigator as Navigator & { gpu?: unknown }).gpu !== null,
    "",
  );
  add(
    "AudioWorklet",
    typeof G.AudioWorklet === "function" &&
      typeof ((window as Window & { AudioWorkletNode?: unknown }).AudioWorkletNode ||
        null) === "function",
    "",
  );
  add(
    "getDisplayMedia",
    typeof navigator.mediaDevices?.getDisplayMedia === "function",
    "",
  );

  // WebAssembly SIMD detection (sync, matches util.js:2020-2024)
  let simdOk = false;
  try {
    simdOk = WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9,
        1, 7, 0, 65, 0, 253, 15, 26, 11,
      ]),
    );
  } catch (_) {
    simdOk = false;
  }
  add(
    "WebAssembly SIMD",
    simdOk,
    simdOk ? "validated" : "NOT supported — audio denoise disabled",
  );

  return results;
}

// WebCodecs configSupported — uses the SAME config the SDK uses
// (util.js:5386 and 5408)
export async function probeVideoDecoder(): Promise<WebCodecsProbeResult | null> {
  const G = globalThis as Record<string, unknown>;
  if (typeof G.VideoDecoder !== "function") return null;
  const VD = G.VideoDecoder as unknown as CodecConfigChecker;
  try {
    const extradata = new Uint8Array([
      1, 100, 0, 31, 255, 225, 0, 14, 103, 100, 0, 51, 172, 27, 26, 17,
      129, 64, 22, 201, 160, 16, 7, 0, 5, 104, 200, 66, 60, 48,
    ]);
    const result = await VD.isConfigSupported({
      codec: "avc1.640028",
      description: extradata,
      codedWidth: 1280,
      codedHeight: 720,
      optimizeForLatency: true,
      hardwareAcceleration: "prefer-hardware",
    });
    return { supported: !!result?.supported, config: result?.config };
  } catch (e) {
    return { supported: false, error: String(e) };
  }
}

export async function probeVideoEncoder(): Promise<WebCodecsProbeResult | null> {
  const G = globalThis as Record<string, unknown>;
  if (typeof G.VideoEncoder !== "function") return null;
  const VE = G.VideoEncoder as unknown as CodecConfigChecker;
  try {
    const result = await VE.isConfigSupported({
      codec: "avc1.640028",
      avc: { format: "annexb" },
      bitrate: 1500000,
      width: 1280,
      height: 720,
      framerate: 25,
      hardwareAcceleration: "no-preference",
      latencyMode: "realtime",
    });
    return { supported: !!result?.supported, config: result?.config };
  } catch (e) {
    return { supported: false, error: String(e) };
  }
}

// Render rows for the async probe results (test.html lines 1071–1097).
export function probeResultToApiRow(label: string, res: WebCodecsProbeResult | null): ApiResult {
  if (!res) {
    return { label, status: "fail", detail: "API missing" };
  }
  const status: Status = res.supported ? "pass" : "fail";
  const detail = res.supported
    ? `supported (HW accel: ${res.config?.hardwareAcceleration || "?"})`
    : `NOT supported${res.error ? ` — ${res.error}` : ""}`;
  return { label, status, detail };
}
