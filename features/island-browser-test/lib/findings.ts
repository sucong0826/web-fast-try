// Verbatim port of the per-finding predicates from test.html (lines 690–971, 1100–1109).

import { versionGreaterOrEqualThan } from "./ua-detection";
import type {
  DetectionContext,
  Finding,
  RawSignals,
  ResolvedEnv,
  Status,
  WebCodecsProbeResult,
} from "./types";
import type { Predicates } from "./ua-detection";

export function detectSAB(): boolean {
  return typeof (globalThis as Record<string, unknown>).SharedArrayBuffer !== "undefined";
}

export function buildSyncFindings(
  ctx: DetectionContext,
  p: Predicates,
  env: ResolvedEnv,
): Finding[] {
  const { ua, raw, browser, engine, os } = ctx;
  const out: Finding[] = [];
  const add = (
    id: string,
    feature: string,
    gate: string,
    status: Status,
    detail: string,
  ) => out.push({ id, feature, gate, status, detail });

  const hwConcurrency = raw.hardwareConcurrency || 0;
  const G = globalThis as Record<string, unknown>;
  const hasSAB = env.hasSAB;
  const hasMSTP = typeof G.MediaStreamTrackProcessor === "function";

  // Replicate util.js:525-531: this.browser.isChromeOrEdge
  const browserIsChromeOrEdge =
    browser.name === "Chrome" ||
    browser.name === "Edge" ||
    browser.name === "Chromium";

  // Replicate util.js:1829 isSupportVideoShareSend()
  const isIphoneOrIpad = /(iPad|iPhone)/.test(ua);
  const isAndroidIntegrationWithSAB = false; // not detectable from page
  const isTeslaMode = /TESLA/.test(ua);
  const verNum = parseInt(browser.version, 10) || 0;
  let videoShareSend = false;
  let videoShareSendReason = "";
  if (!hasSAB) {
    videoShareSendReason = "SharedArrayBuffer unavailable";
  } else if (!browserIsChromeOrEdge) {
    videoShareSendReason =
      "!this.browser.isChromeOrEdge ← Island fails here";
  } else if (verNum && verNum <= 100) {
    videoShareSendReason = "browser version <= 100";
  } else if (hwConcurrency <= 2) {
    videoShareSendReason = "hardwareConcurrency <= 2";
  } else if (isTeslaMode) {
    videoShareSendReason = "Tesla mode";
  } else if (p.isAndroid() && !isAndroidIntegrationWithSAB) {
    videoShareSendReason = "Android without SAB integration";
  } else if (isIphoneOrIpad) {
    videoShareSendReason = "iPhone/iPad browser";
  } else {
    videoShareSend = true;
  }
  add(
    "H1",
    "Video file share + 1080p video share send",
    "isSupportVideoShareSend()",
    videoShareSend ? "pass" : "fail",
    videoShareSend
      ? 'Returns true → "Share Screen → Video file" is available, 1080p video share send enabled.'
      : `Returns false (${videoShareSendReason}) → Cannot share a video file via "Optimize for Video Clip". 1080p video share send unavailable.`,
  );

  // Replicate util.js:786 isSupport2DCanvasDrawFrame
  const is2DCanvas =
    hasMSTP &&
    browserIsChromeOrEdge &&
    verNum >= 104 &&
    raw.appVersion.indexOf("Mac") === -1;
  add(
    "H2",
    "Modern video capture pipeline (MediaStreamTrackProcessor)",
    "isSupport2DCanvasDrawFrame()",
    is2DCanvas ? "pass" : hasMSTP ? "warn" : "fail",
    is2DCanvas
      ? "Returns true → modern share-encoder pipeline available."
      : !hasMSTP
        ? "MediaStreamTrackProcessor API missing → no modern pipeline regardless."
        : `Returns false (${
            !browserIsChromeOrEdge
              ? "browser.isChromeOrEdge=false"
              : verNum < 104
                ? "version<104"
                : "Mac"
          }) → legacy share-capture path → ~10–20% higher CPU during screen/video share.`,
  );

  // Replicate util.js:3344 isChromeBase in videoToMediaStreamManager
  const isChromeBaseLocal = browserIsChromeOrEdge;
  add(
    "H3",
    "Shared video file frame rate (file-input capture)",
    "videoToMediaStreamManager isChromeBase ? 24fps : 10fps",
    isChromeBaseLocal ? "pass" : "warn",
    isChromeBaseLocal
      ? "24fps draw rate for shared local video files."
      : "Capped at 10fps → shared local video plays visibly choppy to receivers. (Only relevant after H1 is fixed.)",
  );

  // Replicate wmsc.videoMgr.js:115 — only matters if Blink kernel < 124
  const kernelGE124 = p.isChromeVersionHigherThan(124);
  add(
    "H4",
    "H.264 baseline codec preference workaround",
    "(isChromeOrChromium || isEdge) && !chromiumVer>=124",
    !browserIsChromeOrEdge && !kernelGE124 ? "fail" : "pass",
    !browserIsChromeOrEdge && !kernelGE124
      ? "Workaround skipped AND Blink kernel < 124 → setCodecPreferences may fail → black tiles for received video."
      : kernelGE124
        ? "Blink kernel >= 124 → workaround not needed anyway."
        : "Workaround applies normally.",
  );

  // Replicate wmsc.mIdMgr.ts:264 changeHWDecodeLimit
  const hwDecodeLimitSet =
    (p.isEdge() || p.isChromeOrChromium()) && (p.isMac() || p.isWindows());
  add(
    "H5",
    "AVC High hardware decoder cap (8 on Win/Mac)",
    "(isEdge || isChromeOrChromium) && (Mac || Windows)",
    hwDecodeLimitSet ? "pass" : p.isMac() || p.isWindows() ? "fail" : "pass",
    hwDecodeLimitSet
      ? "HW decoder cap set to 8 — correct for Win/Mac."
      : p.isMac() || p.isWindows()
        ? `HW decoder cap NOT lowered to 8 → in meetings with >8 AVC High video tiles, expect black tiles. (Platform: ${os}, browser.isChromeOrChromium=${p.isChromeOrChromium()})`
        : "Non-Win/Mac platform — no impact.",
  );

  // Replicate util.js:358 getWasmMemorySaveMode
  const shouldForceDefaultMemMode =
    p.isWindowsChrome() /* && !isWindows32bitChrome — not detectable */ ||
    (p.isMac() && p.isChrome());
  add(
    "H6",
    "WASM memory save mode (force default on Chrome Win/Mac)",
    "(isWindowsChrome() && !is32bit) || (isMac() && isChrome())",
    shouldForceDefaultMemMode
      ? "pass"
      : (p.isWindows() || p.isMac()) && p.isBlinkKernel()
        ? "warn"
        : "pass",
    shouldForceDefaultMemMode
      ? "Default memory mode forced — correct."
      : (p.isWindows() || p.isMac()) && p.isBlinkKernel()
        ? "Force-default branch SKIPPED on a Blink Win/Mac browser. If AB option sets memorySave>0, Island workers may hit WASM OOM in long calls."
        : "N/A on this platform.",
  );

  // H7 — HorizonSDK raw UA check
  const horizonUaHasChrome = /Chrome/i.test(ua) || /Electron/i.test(ua);
  add(
    "H7",
    "Horizon SDK browser routing (VDI/Omnissa Horizon)",
    "navigator.userAgent.indexOf('Chrome') !== -1",
    horizonUaHasChrome ? "pass" : "fail",
    horizonUaHasChrome
      ? 'UA contains "Chrome" → HorizonSDK classifies as CHROME — VDI WebRTC redirection enabled.'
      : 'UA does NOT contain "Chrome" → HorizonSDK classifies as UNSUPPORTED. In Horizon VDI, no WebRTC redirection → severe lag.',
  );

  // M1 — DeviceManager.js:280
  const m1Pass =
    p.isSafari() || p.isFirefox() || p.isChromeOrChromium() || p.isEdge();
  add(
    "M1",
    "NoAudioOutput telemetry monitor",
    "(isSafariHi || isFirefoxHi || isChromeOrChromium || isEdge)",
    m1Pass ? "pass" : "info",
    m1Pass
      ? "Telemetry path covered."
      : "Internal telemetry only — no user-visible impact. We just lose visibility into Island users with missing audio output.",
  );

  // M2 — isLessTestBrowser
  const isOnDesktopOS = p.isWindows() || p.isMac() || p.isChromeOS();
  const isKnownBrowser =
    p.isChrome() || p.isEdge() || p.isSafari() || p.isFirefox();
  const m2LessTest = !(isOnDesktopOS && isKnownBrowser);
  add(
    "M2",
    "Less-tested-browser flag (forces WebRTC audio fallback if AB on)",
    "isLessTestBrowser()",
    m2LessTest ? "warn" : "pass",
    m2LessTest
      ? "Returns TRUE → if Zoom enables LESS_TEST_BROWSER_FORCE_USE_WEBRTC AB option, audio is forced to browser-native WebRTC path (lower quality, no Zoom AEC/denoise)."
      : "Returns false → audio uses Zoom WASM path normally.",
  );

  // M3 — Android binaural audio (Island Android only)
  const m3 = p.isAndroid() && browserIsChromeOrEdge && hwConcurrency >= 8;
  add(
    "M3",
    "Android: auto-enable audio denoise (canAudioDenoiseOnDirectly)",
    "isAndroid && browser.isChromeOrEdge && cores>=8",
    !p.isAndroid() ? "pass" : m3 ? "pass" : "warn",
    !p.isAndroid()
      ? "Not Android — N/A."
      : m3
        ? "Denoise auto-enabled."
        : `Returns 0 — denoise NOT auto-enabled (cores=${hwConcurrency}, isChromeOrEdge=${browserIsChromeOrEdge}). User can still enable manually.`,
  );

  // M4 — audio denoise version<=100 guard skipped on Island (mostly benign)
  add(
    "M4",
    "Audio denoise pre-Chrome-100 safety check",
    "isSupportAudioDenoise (skipped Chrome<=100 guard)",
    !browserIsChromeOrEdge && p.isBlinkKernel() && verNum > 0 && verNum <= 100
      ? "warn"
      : "pass",
    !browserIsChromeOrEdge && p.isBlinkKernel() && verNum > 0 && verNum <= 100
      ? "Browser-name <=100 guard skipped; if your Blink kernel is also old, denoise may glitch."
      : "Modern Island — no real impact.",
  );

  // M5 — YUV cropping (always cropped on Island; minor visual artifact)
  add(
    "M5",
    "YUV frame cropping on Chrome-fixed kernels",
    "renderUserAgent.isChrome()",
    p.isChrome() ? "pass" : "info",
    p.isChrome()
      ? "Cropping disabled on fixed Chrome versions normally."
      : "Cropping stays ON permanently → may cause 1-2px over-cropping at edges of received tiles. Mostly invisible.",
  );

  // M6 — Android Chrome 147 workaround
  const m6Triggered = p.isAndroid() && /Chrome\/(\d+)/.test(ua);
  const m6ChromeVer = m6Triggered
    ? parseInt((ua.match(/Chrome\/(\d+)/) as RegExpMatchArray)[1], 10)
    : 0;
  const m6KernelGE147 =
    p.isBlinkKernel() && versionGreaterOrEqualThan(engine.version, "147");
  add(
    "M6",
    "Android Chrome 147 RGBA→NV12 workaround",
    "isAndroidChrome147Plus()",
    !p.isAndroid()
      ? "pass"
      : m6Triggered && m6ChromeVer >= 147
        ? "pass"
        : m6KernelGE147
          ? "fail"
          : "pass",
    !p.isAndroid()
      ? "Not Android — N/A."
      : m6Triggered && m6ChromeVer >= 147
        ? "UA has Chrome/147+ — workaround applied."
        : m6KernelGE147
          ? "Blink kernel >= 147 BUT UA regex missed Island → workaround NOT applied → other participants will see frozen video from this user."
          : `Blink kernel < 147 — bug not present. (Kernel: ${engine.version || "unknown"})`,
  );

  // R1 — WASM tag renderer
  add(
    "R1",
    "WASM tag renderer (RenderConfig)",
    "renderUserAgent.isBlink()",
    p.isBlinkKernel() ? "pass" : "fail",
    p.isBlinkKernel()
      ? "Engine reported as Blink → WASM tag renderer enabled."
      : "Engine NOT reported as Blink → falls back to slower JS tag renderer (higher CPU during render).",
  );

  // R2 — Mac Intel HW accel flag
  const isMacIntel = p.isMac() && /Intel/.test(raw.platform);
  add(
    "R2",
    "Mac Intel hardware acceleration flag (WMSC)",
    "isMacIntelSafariOrChrome()",
    !isMacIntel ? "pass" : p.isMacIntelSafariOrChrome() ? "pass" : "warn",
    !isMacIntel
      ? "Not Mac Intel — N/A."
      : p.isMacIntelSafariOrChrome()
        ? "Mac Intel HW-accel flag correctly set."
        : "Mac Intel detected, but isChrome/isSafari both false → HW-accel tweaks dropped → possibly lower encode/decode perf.",
  );

  // R3 — setWebRTCMode
  const r3 = p.isWindowsChrome();
  add(
    "R3",
    "setWebRTCMode (Windows VDI optimization)",
    "isWindowsChrome()",
    r3 ? "pass" : p.isWindows() ? "info" : "pass",
    r3
      ? "setWebRTCMode API callable."
      : p.isWindows()
        ? "On Windows but not detected as Chrome → setWebRTCMode silently no-ops. Combined with H7, Island in Horizon VDI gets NO WebRTC mode AND NO redirection."
        : "Not Windows — N/A.",
  );

  return out;
}

export function buildWebCodecsFinding(
  decRes: WebCodecsProbeResult | null,
  encRes: WebCodecsProbeResult | null,
): Finding {
  // Mirror util.js:464-470 — isSupportWebCodecs requires both
  const supportsBoth = !!(decRes?.supported && encRes?.supported);
  return {
    id: "W1",
    feature: "WebCodecs encode+decode (AVC H.264)",
    gate: "isSupportVideoWebCodecDecode() && isSupportVideoWebCodecEncode()",
    status: supportsBoth ? "pass" : "fail",
    detail: supportsBoth
      ? "Both WebCodecs paths supported with this build."
      : `WebCodecs not fully supported — VideoDecoder:${decRes?.supported}, VideoEncoder:${encRes?.supported}. Video calls will fall back to WASM software encode (high CPU).`,
  };
}
