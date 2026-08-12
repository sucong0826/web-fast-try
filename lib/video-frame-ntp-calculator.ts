export const NTP_UNIX_EPOCH_OFFSET_MS = 2_208_988_800_000;
const MAX_JAVASCRIPT_DATE_UNIX_EPOCH_MS = 8_640_000_000_000_000n;

export type NtpCalculationMethod =
  | "capture-time"
  | "video-frame-timestamp";

export interface NtpCalculationResult {
  method: NtpCalculationMethod;
  confidence: "preferred" | "unverified-approximation";
  unixTimestampMs: number;
  ntpTimestampMs: number;
  utcTimestamp: string;
  expression: string;
}

export interface LiveFrameCalculationInput {
  performanceTimeOriginMs: number;
  videoFrameTimestampUs: number;
  metadata?: unknown;
}

export interface LiveFrameCalculationResult extends NtpCalculationResult {
  captureTimeMs: number | null;
}

export type EpochConversionDirection = "unix-to-ntp" | "ntp-to-unix";

export interface EpochConversionResult {
  direction: EpochConversionDirection;
  sourceTimestampMs: string;
  convertedTimestampMs: string;
  unixTimestampMs: string;
  utcTimestamp: string;
  expression: string;
}

function assertNonNegativeFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`);
  }
}

function buildResult(
  method: NtpCalculationMethod,
  performanceTimeOriginMs: number,
  relativeTimestampMs: number,
  expression: string,
): NtpCalculationResult {
  assertNonNegativeFinite(performanceTimeOriginMs, "performance.timeOrigin");
  assertNonNegativeFinite(relativeTimestampMs, "relative timestamp");

  const unixTimestampMs = performanceTimeOriginMs + relativeTimestampMs;
  const ntpTimestampMs = unixTimestampMs + NTP_UNIX_EPOCH_OFFSET_MS;
  const utcDate = new Date(unixTimestampMs);

  if (!Number.isFinite(ntpTimestampMs) || Number.isNaN(utcDate.getTime())) {
    throw new RangeError("calculated timestamp is outside the supported range");
  }

  return {
    method,
    confidence:
      method === "capture-time" ? "preferred" : "unverified-approximation",
    unixTimestampMs,
    ntpTimestampMs,
    utcTimestamp: utcDate.toISOString(),
    expression,
  };
}

export function calculateNtpFromCaptureTime(
  performanceTimeOriginMs: number,
  captureTimeMs: number,
): NtpCalculationResult {
  return buildResult(
    "capture-time",
    performanceTimeOriginMs,
    captureTimeMs,
    `${performanceTimeOriginMs} + ${captureTimeMs} + ${NTP_UNIX_EPOCH_OFFSET_MS}`,
  );
}

export function calculateNtpFromVideoFrameTimestamp(
  performanceTimeOriginMs: number,
  videoFrameTimestampUs: number,
): NtpCalculationResult {
  assertNonNegativeFinite(videoFrameTimestampUs, "VideoFrame.timestamp");

  return buildResult(
    "video-frame-timestamp",
    performanceTimeOriginMs,
    videoFrameTimestampUs / 1_000,
    `${performanceTimeOriginMs} + ${videoFrameTimestampUs} / 1000 + ${NTP_UNIX_EPOCH_OFFSET_MS}`,
  );
}

export function calculateNtpFromFrame(
  input: LiveFrameCalculationInput,
): LiveFrameCalculationResult {
  const candidate =
    input.metadata && typeof input.metadata === "object"
      ? (input.metadata as Record<string, unknown>).captureTime
      : undefined;
  const captureTimeMs =
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0
      ? candidate
      : null;

  const result =
    captureTimeMs === null
      ? calculateNtpFromVideoFrameTimestamp(
          input.performanceTimeOriginMs,
          input.videoFrameTimestampUs,
        )
      : calculateNtpFromCaptureTime(
          input.performanceTimeOriginMs,
          captureTimeMs,
        );

  return { ...result, captureTimeMs };
}

export function parseCalculatorValue(value: string, label: string): number {
  if (value.trim() === "") {
    throw new RangeError(`${label} is required`);
  }

  const parsed = Number(value);
  assertNonNegativeFinite(parsed, label);
  return parsed;
}

export function formatTimestampMilliseconds(value: number): string {
  assertNonNegativeFinite(value, "timestamp");
  return String(value);
}

function parseDecimalMilliseconds(value: string, label: string) {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new RangeError(
      `${label} must be a non-negative decimal millisecond value`,
    );
  }

  const whole = BigInt(match[1]);
  const fraction = match[2] ?? "";
  const normalizedWhole = whole.toString();
  return {
    whole,
    fraction,
    normalized: fraction
      ? `${normalizedWhole}.${fraction}`
      : normalizedWhole,
  };
}

function joinDecimalMilliseconds(whole: bigint, fraction: string) {
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function convertEpochMilliseconds(
  value: string,
  direction: EpochConversionDirection,
): EpochConversionResult {
  const source = parseDecimalMilliseconds(value, "timestamp");
  const offset = BigInt(NTP_UNIX_EPOCH_OFFSET_MS);

  if (direction === "ntp-to-unix" && source.whole < offset) {
    throw new RangeError("NTP timestamp is before the supported Unix epoch");
  }

  const convertedWhole =
    direction === "unix-to-ntp"
      ? source.whole + offset
      : source.whole - offset;
  const convertedTimestampMs = joinDecimalMilliseconds(
    convertedWhole,
    source.fraction,
  );
  const unixTimestampMs =
    direction === "unix-to-ntp" ? source.normalized : convertedTimestampMs;
  const unixWhole =
    direction === "unix-to-ntp" ? source.whole : convertedWhole;
  const exceedsDateRange =
    unixWhole > MAX_JAVASCRIPT_DATE_UNIX_EPOCH_MS ||
    (unixWhole === MAX_JAVASCRIPT_DATE_UNIX_EPOCH_MS &&
      /[1-9]/.test(source.fraction));

  if (exceedsDateRange) {
    throw new RangeError("timestamp is outside the supported UTC date range");
  }

  const numericUnixTimestampMs = Number(unixTimestampMs);
  const unixDate = new Date(numericUnixTimestampMs);

  if (
    !Number.isFinite(numericUnixTimestampMs) ||
    Number.isNaN(unixDate.getTime())
  ) {
    throw new RangeError("timestamp is outside the supported UTC date range");
  }

  const operator = direction === "unix-to-ntp" ? "+" : "-";
  return {
    direction,
    sourceTimestampMs: source.normalized,
    convertedTimestampMs,
    unixTimestampMs,
    utcTimestamp: unixDate.toISOString(),
    expression: `${source.normalized} ${operator} ${NTP_UNIX_EPOCH_OFFSET_MS} = ${convertedTimestampMs}`,
  };
}
