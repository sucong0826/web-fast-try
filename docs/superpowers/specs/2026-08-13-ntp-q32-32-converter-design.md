# NTP Q32.32 Decimal Converter Design

## Goal

Add a calculator that converts a decimal-string representation of an NTP 64-bit Q32.32 timestamp into a standard Unix timestamp, without losing precision in JavaScript.

## Input Scope

The input is one non-negative base-10 integer representing the complete NTP 64-bit Q32.32 value, not a decimal seconds string. For example:

```text
17160596469120441998
```

The calculator interprets this as NTP Era 0 only. Its seconds field therefore covers the Unix interval from 1970-01-01 through the first NTP era rollover in 2036. Inputs whose seconds field is before the Unix epoch are rejected to match the existing Unix/NTP epoch converter. Post-2036 NTP era resolution is intentionally out of scope because a 64-bit NTP value alone does not identify the era.

## Calculation

All integer arithmetic uses `BigInt`.

```ts
const NTP_FRACTION_SCALE = 1n << 32n;
const NTP_UNIX_EPOCH_OFFSET_SECONDS = 2_208_988_800n;

ntpSeconds = packedQ32_32 >> 32n;
ntpFraction = packedQ32_32 & (NTP_FRACTION_SCALE - 1n);
unixSeconds = ntpSeconds - NTP_UNIX_EPOCH_OFFSET_SECONDS;
```

The Unix timestamp is presented as a decimal seconds string with twelve fractional digits:

```ts
unixSecondsText = `${unixSeconds}.${floor(ntpFraction * 10^12 / 2^32)}`;
```

The Unix millisecond result is separately presented with twelve digits after its decimal point. Both fractional displays are truncated, never converted through `Number`.

For the JavaScript UTC and browser-local time display, the calculator uses only the whole millisecond portion. That display is explicitly millisecond precision, while the copyable Unix timestamp preserves the higher Q32.32-derived precision.

For input `17160596469120441998`, the result is:

```text
NTP seconds:        3995512721
NTP fraction:        1673469582 / 4294967296
Unix timestamp:      1786523921.389634999912
Unix milliseconds:   1786523921389.634999912
UTC:                 2026-08-12T08:38:41.389Z
```

## UI

The existing closed `Epoch converter` disclosure gains a second calculator titled `NTP Q32.32 → Unix timestamp` after the decimal-millisecond converter. It contains:

- One `NTP Q32.32 decimal value` input and a Convert button.
- An Era 0 label and a concise explanation of the 2036 limit.
- A result panel containing Unix timestamp seconds, Unix milliseconds, UTC, browser-local time, plus a closed `Show Q32.32 fields` disclosure for NTP seconds, NTP fraction, and the substituted expression.
- A copy action for the Unix timestamp seconds string.

## Validation and Testing

- Reject empty, signed, decimal-point, non-digit, and values greater than `2^64 - 1`.
- Reject values before Unix epoch in Era 0.
- Unit-test the supplied sample result, the Unix epoch boundary, maximum 64-bit input parsing, invalid formats, and out-of-era date handling.
- Extend the static page test for the Q32.32 title and Era 0 explanation.

## Non-goals

- NTP Era selection or automatic post-2036 era recovery.
- Q32.32 encoding from Unix time.
- Changing any existing capture, NTP decimal-millisecond, or timezone-display behavior.
