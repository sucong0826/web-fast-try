// Verbatim port of the detection logic from test.html (lines 343–536).
// Behavior — regexes, branch order, output keys, output values — must NOT change.

import type {
  DetectionContext,
  ParsedBrowser,
  ParsedEngine,
  RawSignals,
  UaResult,
} from "./types";

export function collectRawSignals(): RawSignals {
  const ua = navigator.userAgent || "";
  const nav = navigator as Navigator & {
    userAgentData?: {
      brands?: unknown;
      mobile?: unknown;
      platform?: unknown;
    };
    deviceMemory?: number;
    brave?: { isBrave?: () => unknown };
  };
  const uaData = nav.userAgentData || null;
  return {
    userAgent: ua,
    vendor: navigator.vendor || "",
    platform: navigator.platform || "",
    appVersion: navigator.appVersion || "",
    language: navigator.language || "",
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    userAgentDataPresent: !!uaData,
    userAgentDataBrands: uaData?.brands ?? null,
    userAgentDataMobile: uaData?.mobile ?? null,
    userAgentDataPlatform: uaData?.platform ?? null,
    screenWidth: screen.width,
    screenHeight: screen.height,
    devicePixelRatio: window.devicePixelRatio || 1,
    crossOriginIsolated: (window as Window & { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
    isBraveExposed:
      typeof nav.brave === "object" &&
      typeof nav.brave?.isBrave === "function",
  };
}

export function parseBrowserName(ua: string): ParsedBrowser {
  // Order matters — more specific patterns first.
  const tests = [
    { re: /\b(?:crmo|crios)\/([\w\.]+)/i, name: "Chrome" },
    { re: /edg(?:e|ios|a)?\/([\w\.]+)/i, name: "Edge" },
    { re: /(opera|opr)\/([\w\.]+)/i, name: "Opera" },
    { re: /(samsungbrowser)\/([\w\.]+)/i, name: "Samsung Internet" },
    { re: /(brave)\/([\w\.]+)/i, name: "Brave" },
    { re: /(vivaldi)\/([\w\.]+)/i, name: "Vivaldi" },
    { re: /headlesschrome\/([\w\.]+)/i, name: "Chrome Headless" },
    { re: / wv\).+(chrome)\/([\w\.]+)/i, name: "Chrome WebView" },
    { re: /(chromium)\/([\w\.]+)/i, name: "Chromium" },
    { re: /(chrome)\/([\w\.]+)/i, name: "Chrome" },
    { re: /(fxios)\/([\w\.-]+)/i, name: "Firefox" },
    { re: /(firefox)\/([\w\.]+)/i, name: "Firefox" },
    { re: /version\/([\w\.\,]+) .*(safari)/i, name: "Safari" },
    { re: /(safari)\/([\w\.]+)/i, name: "Safari" },
  ];
  for (const t of tests) {
    const m = ua.match(t.re);
    if (m) {
      const ver =
        m
          .slice(1)
          .reverse()
          .find((g) => /^[\d\.]+$/.test(g || "")) || "";
      return { name: t.name, version: ver, matched: t.re.source };
    }
  }
  return { name: "unknown", version: "", matched: null };
}

export function parseEngine(ua: string): ParsedEngine {
  // ua-helper's Ye[] regex array, key entries:
  //   /webkit\/537\.36.+chrome\/(?!27)([\w\.]+)/i  →  Blink
  //   /(webkit|khtml)\/([\w\.]+)/i                  →  WebKit
  //   /rv:([\w\.]+).+(gecko)/i                       →  Gecko
  const blinkMatch = ua.match(/webkit\/537\.36.+chrome\/(?!27)([\w\.]+)/i);
  if (blinkMatch) {
    return { name: "Blink", version: blinkMatch[1] };
  }
  const edgehtml = ua.match(/edge\/([\w\.]+)/i);
  if (edgehtml) return { name: "EdgeHTML", version: edgehtml[1] };
  const gecko = ua.match(/rv:([\w\.]+)\b.+gecko/i);
  if (gecko) return { name: "Gecko", version: gecko[1] };
  const webkit = ua.match(/(webkit|khtml)\/([\w\.]+)/i);
  if (webkit) return { name: webkit[1], version: webkit[2] };
  const trident = ua.match(/trident\/([\w\.]+)/i);
  if (trident) return { name: "Trident", version: trident[1] };
  return { name: "unknown", version: "" };
}

export function parseOS(plat: string, ua: string): string {
  if (/Win/i.test(plat)) return "Windows";
  if (/Mac/i.test(plat)) return "macOS";
  if (/Linux/i.test(plat)) {
    if (/Android/i.test(ua)) return "Android";
    if (/CrOS/i.test(ua)) return "ChromeOS";
    return "Linux";
  }
  if (/iPhone|iPad|iPod/i.test(plat)) return "iOS";
  return "unknown";
}

export function versionGreaterOrEqualThan(a: string | number, b: string | number): boolean {
  if (!a || !b) return false;
  const pa = String(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

export function buildContext(): DetectionContext {
  const raw = collectRawSignals();
  const ua = raw.userAgent;
  const browser = parseBrowserName(ua);
  const engine = parseEngine(ua);
  const os = parseOS(raw.platform, ua);
  return { ua, raw, browser, engine, os };
}

// SDK helper predicates — closure over a DetectionContext so they read exactly
// the same `raw`/`browser`/`engine` values the page snapshot used.
export interface Predicates {
  isMac: () => boolean;
  isWindows: () => boolean;
  isChromeOS: () => boolean;
  isAndroid: () => boolean;
  isMobile: () => boolean;
  isChromeOrChromium: () => boolean;
  isChrome: () => boolean;
  isEdge: () => boolean;
  isFirefox: () => boolean;
  isSafari: () => boolean;
  isBlinkKernel: () => boolean;
  isWindowsChrome: () => boolean;
  isMacIntelSafariOrChrome: () => boolean;
  isChromeVersionHigherThan: (n: number) => boolean;
}

export function buildPredicates(ctx: DetectionContext): Predicates {
  const { ua, raw, browser, engine } = ctx;
  const isMac = () => /Mac/.test(raw.platform);
  const isWindows = () => /Win/.test(raw.platform);
  const isChromeOS = () => /\bCrOS\b/.test(ua);
  const isAndroid = () => /Android/i.test(ua);
  const isMobile = () =>
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(ua);
  const isChromeOrChromium = () =>
    browser.name === "Chrome" || browser.name === "Chromium";
  const isChrome = () => browser.name === "Chrome";
  const isEdge = () => browser.name === "Edge";
  const isFirefox = () => browser.name === "Firefox";
  const isSafari = () => browser.name === "Safari";
  const isBlinkKernel = () => engine.name === "Blink";
  const isWindowsChrome = () => isWindows() && isChromeOrChromium();
  const isMacIntelSafariOrChrome = () =>
    isMac() && /Intel/i.test(raw.platform) && (isChrome() || isSafari());
  const isChromeVersionHigherThan = (n: number) => {
    if (isChromeOrChromium() || isEdge()) {
      return versionGreaterOrEqualThan(browser.version, String(n));
    }
    if (isBlinkKernel()) {
      return versionGreaterOrEqualThan(engine.version, String(n));
    }
    return false;
  };
  return {
    isMac,
    isWindows,
    isChromeOS,
    isAndroid,
    isMobile,
    isChromeOrChromium,
    isChrome,
    isEdge,
    isFirefox,
    isSafari,
    isBlinkKernel,
    isWindowsChrome,
    isMacIntelSafariOrChrome,
    isChromeVersionHigherThan,
  };
}

export function buildUaResult(ctx: DetectionContext, p: Predicates): UaResult {
  const { browser, engine, os } = ctx;
  return {
    "browser.name": browser.name,
    "browser.version": browser.version,
    "engine.name": engine.name,
    "engine.version (kernel)": engine.version,
    "os (inferred)": os,
    "isChromeOrChromium()": p.isChromeOrChromium(),
    "isChrome()": p.isChrome(),
    "isEdge()": p.isEdge(),
    "isFirefox()": p.isFirefox(),
    "isSafari()": p.isSafari(),
    "isBlinkKernel()": p.isBlinkKernel(),
    "isWindows()": p.isWindows(),
    "isMac()": p.isMac(),
    "isChromeOS()": p.isChromeOS(),
    "isAndroid()": p.isAndroid(),
    "isMobile()": p.isMobile(),
    "isWindowsChrome()": p.isWindowsChrome(),
    "isMacIntelSafariOrChrome()": p.isMacIntelSafariOrChrome(),
    "isChromeVersionHigherThan(91)": p.isChromeVersionHigherThan(91),
    "isChromeVersionHigherThan(95)": p.isChromeVersionHigherThan(95),
    "isChromeVersionHigherThan(111)": p.isChromeVersionHigherThan(111),
    "isChromeVersionHigherThan(124)": p.isChromeVersionHigherThan(124),
    "isChromeVersionHigherThan(147)": p.isChromeVersionHigherThan(147),
  };
}
