const MICROSECONDS_PER_SECOND = 1_000_000n;
const MICROSECONDS_PER_MILLISECOND = 1_000n;
const NTP_FRACTION_SCALE = 1n << 32n;
const MAX_NTP_Q32_32 = (1n << 64n) - 1n;

export const NTP_UNIX_EPOCH_OFFSET_US = 2_208_988_800_000_000n;
export const TIME_ORIGIN_PLAUSIBILITY_WINDOW_MS = 5_000;

export type ServerNtpFormat = "epoch-ms" | "q32.32";

export interface ClientFrameAnchor {
  frameTimestampUs: number;
  unixEpochUs: number;
}

export interface ServerFrameAnchor {
  frameTimestampUs: number;
  ntpEpochUs: bigint;
}

export interface FrameTimestampStrategyInput {
  frameTimestampUs: number;
  observedUnixEpochUs: number;
  performanceTimeOriginMs: number;
  performanceNowMs: number;
  clientAnchor: ClientFrameAnchor;
  serverAnchor: ServerFrameAnchor | null;
}

export interface FrameTimestampStrategies {
  naiveUnixEpochUs: bigint;
  timeOriginUnixEpochUs: bigint;
  clientAnchorUnixEpochUs: bigint;
  manualServerNtpEpochUs: bigint | null;
  performanceDeltaMs: number;
  timeOriginPlausible: boolean;
}

function assertNonNegativeSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Expected ${label} to be a non-negative safe integer`);
  }
}

function parseUnsignedInteger(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new RangeError(`Expected ${label} to be an unsigned decimal integer`);
  }
  return BigInt(value);
}

export function parseNtpEpochMilliseconds(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) {
    throw new RangeError(
      "Expected NTP epoch milliseconds with at most three fractional digits",
    );
  }

  const wholeMilliseconds = BigInt(match[1]);
  const fractionalMicroseconds = BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  return wholeMilliseconds * MICROSECONDS_PER_MILLISECOND + fractionalMicroseconds;
}

export function formatNtpEpochMilliseconds(ntpEpochUs: bigint): string {
  if (ntpEpochUs < 0n) {
    throw new RangeError("Expected a non-negative NTP epoch timestamp");
  }

  const milliseconds = ntpEpochUs / MICROSECONDS_PER_MILLISECOND;
  const remainingMicroseconds = ntpEpochUs % MICROSECONDS_PER_MILLISECOND;
  if (remainingMicroseconds === 0n) return milliseconds.toString();

  const fraction = remainingMicroseconds
    .toString()
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${milliseconds}.${fraction}`;
}

export function ntpEpochUsToQ32_32(ntpEpochUs: bigint): string {
  if (ntpEpochUs < 0n) {
    throw new RangeError("Expected a non-negative NTP epoch timestamp");
  }

  const seconds = ntpEpochUs / MICROSECONDS_PER_SECOND;
  const microsecondsWithinSecond = ntpEpochUs % MICROSECONDS_PER_SECOND;
  const fraction =
    (microsecondsWithinSecond * NTP_FRACTION_SCALE +
      MICROSECONDS_PER_SECOND / 2n) /
    MICROSECONDS_PER_SECOND;
  const value = (seconds << 32n) | fraction;

  if (value > MAX_NTP_Q32_32) {
    throw new RangeError("NTP timestamp exceeds unsigned Q32.32 range");
  }
  return value.toString();
}

export function q32_32ToNtpEpochUs(value: string): bigint {
  const timestamp = parseUnsignedInteger(value.trim(), "NTP Q32.32 timestamp");
  if (timestamp > MAX_NTP_Q32_32) {
    throw new RangeError("NTP timestamp exceeds unsigned Q32.32 range");
  }

  const seconds = timestamp >> 32n;
  const fraction = timestamp & 0xffffffffn;
  return (
    seconds * MICROSECONDS_PER_SECOND +
    (fraction * MICROSECONDS_PER_SECOND + NTP_FRACTION_SCALE / 2n) /
      NTP_FRACTION_SCALE
  );
}

export function normalizeServerNtpTimestamp(
  value: string,
  format: ServerNtpFormat,
): bigint {
  return format === "epoch-ms"
    ? parseNtpEpochMilliseconds(value)
    : q32_32ToNtpEpochUs(value);
}

export function calculateFrameTimestampStrategies(
  input: FrameTimestampStrategyInput,
): FrameTimestampStrategies {
  assertNonNegativeSafeInteger(input.frameTimestampUs, "VideoFrame timestamp");
  assertNonNegativeSafeInteger(input.observedUnixEpochUs, "observed Unix timestamp");
  assertNonNegativeSafeInteger(
    input.clientAnchor.frameTimestampUs,
    "client anchor VideoFrame timestamp",
  );
  assertNonNegativeSafeInteger(
    input.clientAnchor.unixEpochUs,
    "client anchor Unix timestamp",
  );
  if (
    !Number.isFinite(input.performanceTimeOriginMs) ||
    input.performanceTimeOriginMs < 0 ||
    !Number.isFinite(input.performanceNowMs) ||
    input.performanceNowMs < 0
  ) {
    throw new RangeError("Expected finite, non-negative performance clock values");
  }

  const frameTimestampUs = BigInt(input.frameTimestampUs);
  const frameDeltaFromClientAnchorUs =
    frameTimestampUs - BigInt(input.clientAnchor.frameTimestampUs);
  const performanceDeltaMs =
    input.frameTimestampUs / 1_000 - input.performanceNowMs;

  let manualServerNtpEpochUs: bigint | null = null;
  if (input.serverAnchor) {
    assertNonNegativeSafeInteger(
      input.serverAnchor.frameTimestampUs,
      "server anchor VideoFrame timestamp",
    );
    manualServerNtpEpochUs =
      input.serverAnchor.ntpEpochUs +
      frameTimestampUs -
      BigInt(input.serverAnchor.frameTimestampUs);
  }

  return {
    naiveUnixEpochUs: frameTimestampUs,
    timeOriginUnixEpochUs:
      BigInt(Math.round(input.performanceTimeOriginMs * 1_000)) +
      frameTimestampUs,
    clientAnchorUnixEpochUs:
      BigInt(input.clientAnchor.unixEpochUs) + frameDeltaFromClientAnchorUs,
    manualServerNtpEpochUs,
    performanceDeltaMs,
    timeOriginPlausible:
      Math.abs(performanceDeltaMs) <= TIME_ORIGIN_PLAUSIBILITY_WINDOW_MS,
  };
}
