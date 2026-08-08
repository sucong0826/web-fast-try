const MICROSECONDS_PER_SECOND = 1_000_000n;
const MILLISECONDS_PER_SECOND = 1_000n;
const NTP_UNIX_EPOCH_OFFSET_SECONDS = 2_208_988_800n;
const NTP_FRACTION_SCALE = 1n << 32n;

export interface NtpTimestampParts {
  seconds: string;
  fraction: string;
}

export interface NtpTimestampMatch {
  index: number | null;
  diffMs: number | null;
  matched: boolean;
}

export function unixEpochUsToNtpTimestamp(unixEpochUs: number): string {
  if (!Number.isSafeInteger(unixEpochUs) || unixEpochUs < 0) {
    throw new RangeError(
      `Expected a non-negative Unix-epoch microsecond integer, received ${unixEpochUs}`,
    );
  }

  const unixUs = BigInt(unixEpochUs);
  const seconds =
    unixUs / MICROSECONDS_PER_SECOND + NTP_UNIX_EPOCH_OFFSET_SECONDS;
  const microsecondsWithinSecond = unixUs % MICROSECONDS_PER_SECOND;
  const fraction =
    (microsecondsWithinSecond * NTP_FRACTION_SCALE +
      MICROSECONDS_PER_SECOND / 2n) /
    MICROSECONDS_PER_SECOND;

  return ((seconds << 32n) | fraction).toString();
}

export function ntpTimestampToParts(ntpTimestamp: string): NtpTimestampParts {
  const value = BigInt(ntpTimestamp);

  return {
    seconds: (value >> 32n).toString(),
    fraction: (value & 0xffffffffn).toString(),
  };
}

export function findNearestNtpTimestamp(
  serverTimestamps: readonly string[],
  targetTimestamp: string,
  toleranceMs: number,
): NtpTimestampMatch {
  if (serverTimestamps.length === 0) {
    return { index: null, diffMs: null, matched: false };
  }

  const target = BigInt(targetTimestamp);
  let nearestIndex = 0;
  let nearestDifference: bigint | null = null;

  serverTimestamps.forEach((timestamp, index) => {
    const candidate = BigInt(timestamp);
    const difference =
      candidate >= target ? candidate - target : target - candidate;

    if (nearestDifference === null || difference < nearestDifference) {
      nearestDifference = difference;
      nearestIndex = index;
    }
  });

  const diffMs = Number(
    (nearestDifference! * MILLISECONDS_PER_SECOND + NTP_FRACTION_SCALE / 2n) /
      NTP_FRACTION_SCALE,
  );

  return {
    index: nearestIndex,
    diffMs,
    matched: diffMs <= toleranceMs,
  };
}

export function parseNtpTimestampList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/\d{10,}/)?.[0])
    .filter((timestamp): timestamp is string => Boolean(timestamp));
}
