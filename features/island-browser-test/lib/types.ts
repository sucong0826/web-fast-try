export type Status = "pass" | "fail" | "warn" | "info" | "na";

export interface RawSignals {
  userAgent: string;
  vendor: string;
  platform: string;
  appVersion: string;
  language: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number | null;
  cookieEnabled: boolean;
  onLine: boolean;
  userAgentDataPresent: boolean;
  userAgentDataBrands: unknown;
  userAgentDataMobile: unknown;
  userAgentDataPlatform: unknown;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  crossOriginIsolated: boolean;
  isBraveExposed: boolean;
}

export interface ParsedBrowser {
  name: string;
  version: string;
  matched: string | null;
}

export interface ParsedEngine {
  name: string;
  version: string;
}

export interface DetectionContext {
  ua: string;
  raw: RawSignals;
  browser: ParsedBrowser;
  engine: ParsedEngine;
  os: string;
}

export type UaResult = Record<string, string | boolean | number>;

export interface ApiResult {
  label: string;
  status: Status;
  detail: string;
}

export interface Finding {
  id: string;
  feature: string;
  gate: string;
  status: Status;
  detail: string;
}

export interface WebCodecsProbeResult {
  supported: boolean;
  config?: { hardwareAcceleration?: string } & Record<string, unknown>;
  error?: string;
}

export type OverrideChoice = "auto" | "yes" | "no";

export interface EnvOverrides {
  sab: OverrideChoice;
}

export interface ResolvedEnv {
  hasSAB: boolean;
  hasSABSource: "auto" | "manual";
  detectedSAB: boolean;
}

