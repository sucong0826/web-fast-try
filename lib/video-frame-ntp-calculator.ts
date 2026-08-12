export const NTP_UNIX_EPOCH_OFFSET_MS = 2_208_988_800_000;
const MAX_JAVASCRIPT_DATE_UNIX_EPOCH_MS = 8_640_000_000_000_000n;

export type NtpCalculationMethod =
  | "capture-time"
  | "timestamp-anchor";

export type FrameTimestampStrategy =
  | "prefer-capture-time"
  | "timestamp-anchor";

export interface FrameClockAnchorObservation {
  anchorOffsetMs: number;
  sampleCount: number;
  observedDelayMs: number;
  wasReset: boolean;
}

export interface NtpCalculationResult {
  method: NtpCalculationMethod;
  confidence: "preferred" | "local-clock-anchor";
  unixTimestampMs: number;
  ntpTimestampMs: number;
  utcTimestamp: string;
  expression: string;
  anchorOffsetMs?: number;
  anchorSampleCount?: number;
  observedDelayMs?: number;
  anchorWasReset?: boolean;
}

export interface LiveFrameCalculationInput {
  performanceTimeOriginMs: number;
  videoFrameTimestampUs: number;
  metadata?: unknown;
  strategy?: FrameTimestampStrategy;
  anchorObservation?: FrameClockAnchorObservation;
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

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
}

const MAX_ANCHOR_SAMPLES = 64;
const MAX_TIMESTAMP_GAP_US = 5_000_000;

export class FrameClockAnchor {
  private offsetsMs: number[] = [];
  private previousTimestampUs: number | null = null;

  reset() {
    this.offsetsMs = [];
    this.previousTimestampUs = null;
  }

  observe(
    videoFrameTimestampUs: number,
    wallProjectionMs: number,
  ): FrameClockAnchorObservation {
    assertNonNegativeFinite(videoFrameTimestampUs, "VideoFrame.timestamp");
    assertNonNegativeFinite(wallProjectionMs, "wall projection");

    const wasReset =
      this.previousTimestampUs !== null &&
      (videoFrameTimestampUs < this.previousTimestampUs ||
        videoFrameTimestampUs - this.previousTimestampUs > MAX_TIMESTAMP_GAP_US);
    if (wasReset) this.reset();

    const sampleOffsetMs = wallProjectionMs - videoFrameTimestampUs / 1_000;
    this.offsetsMs.push(sampleOffsetMs);
    if (this.offsetsMs.length > MAX_ANCHOR_SAMPLES) {
      this.offsetsMs.shift();
    }
    this.previousTimestampUs = videoFrameTimestampUs;

    const anchorOffsetMs = Math.min(...this.offsetsMs);
    return {
      anchorOffsetMs,
      sampleCount: this.offsetsMs.length,
      observedDelayMs: sampleOffsetMs - anchorOffsetMs,
      wasReset,
    };
  }
}

function buildResult(
  method: NtpCalculationMethod,
  unixTimestampMs: number,
  expression: string,
  anchorObservation?: FrameClockAnchorObservation,
): NtpCalculationResult {
  assertNonNegativeFinite(unixTimestampMs, "Unix timestamp");
  const ntpTimestampMs = unixTimestampMs + NTP_UNIX_EPOCH_OFFSET_MS;
  const utcDate = new Date(unixTimestampMs);

  if (!Number.isFinite(ntpTimestampMs) || Number.isNaN(utcDate.getTime())) {
    throw new RangeError("calculated timestamp is outside the supported range");
  }

  return {
    method,
    confidence:
      method === "capture-time" ? "preferred" : "local-clock-anchor",
    unixTimestampMs,
    ntpTimestampMs,
    utcTimestamp: utcDate.toISOString(),
    expression,
    ...(anchorObservation
      ? {
          anchorOffsetMs: anchorObservation.anchorOffsetMs,
          anchorSampleCount: anchorObservation.sampleCount,
          observedDelayMs: anchorObservation.observedDelayMs,
          anchorWasReset: anchorObservation.wasReset,
        }
      : {}),
  };
}

export function calculateNtpFromCaptureTime(
  performanceTimeOriginMs: number,
  captureTimeMs: number,
): NtpCalculationResult {
  assertNonNegativeFinite(performanceTimeOriginMs, "performance.timeOrigin");
  assertNonNegativeFinite(captureTimeMs, "captureTime");
  const unixTimestampMs = performanceTimeOriginMs + captureTimeMs;
  return buildResult(
    "capture-time",
    unixTimestampMs,
    `${performanceTimeOriginMs} + ${captureTimeMs} + ${NTP_UNIX_EPOCH_OFFSET_MS}`,
  );
}

export function calculateNtpFromTimestampAnchor(
  videoFrameTimestampUs: number,
  anchorOffsetMs: number,
  anchorSampleCount = 1,
  observedDelayMs = 0,
  anchorWasReset = false,
): NtpCalculationResult {
  assertNonNegativeFinite(videoFrameTimestampUs, "VideoFrame.timestamp");
  assertFinite(anchorOffsetMs, "anchor offset");
  if (!Number.isInteger(anchorSampleCount) || anchorSampleCount < 1) {
    throw new RangeError("anchor sample count must be a positive integer");
  }
  assertNonNegativeFinite(observedDelayMs, "observed delay");

  const unixTimestampMs = videoFrameTimestampUs / 1_000 + anchorOffsetMs;
  return buildResult(
    "timestamp-anchor",
    unixTimestampMs,
    `${videoFrameTimestampUs} / 1000 + (${anchorOffsetMs}) + ${NTP_UNIX_EPOCH_OFFSET_MS}`,
    {
      anchorOffsetMs,
      sampleCount: anchorSampleCount,
      observedDelayMs,
      wasReset: anchorWasReset,
    },
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

  const strategy = input.strategy ?? "prefer-capture-time";
  const result =
    strategy === "prefer-capture-time" && captureTimeMs !== null
      ? calculateNtpFromCaptureTime(
          input.performanceTimeOriginMs,
          captureTimeMs,
        )
      : (() => {
          if (!input.anchorObservation) {
            throw new RangeError(
              "timestamp anchor observation is required when captureTime is not used",
            );
          }
          return calculateNtpFromTimestampAnchor(
            input.videoFrameTimestampUs,
            input.anchorObservation.anchorOffsetMs,
            input.anchorObservation.sampleCount,
            input.anchorObservation.observedDelayMs,
            input.anchorObservation.wasReset,
          );
        })();

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
