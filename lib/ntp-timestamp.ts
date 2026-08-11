import {
  NTP_UNIX_EPOCH_OFFSET_US,
  ntpEpochUsToQ32_32,
} from "./video-frame-ntp";

const MILLISECONDS_PER_SECOND = 1_000n;
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

  return ntpEpochUsToQ32_32(
    BigInt(unixEpochUs) + NTP_UNIX_EPOCH_OFFSET_US,
  );
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
