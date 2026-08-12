# Simplified VideoFrame NTP Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing four-strategy timestamp laboratory with a latest-frame validator, a two-mode VideoFrame calculator, and an exact Unix/NTP epoch-millisecond converter.

**Architecture:** Put all timestamp selection, validation, and arithmetic in a pure helper module so live frames and manually entered values use the same formulas. The Unix/NTP converter uses decimal-string arithmetic so adding or subtracting the integer epoch offset does not introduce floating-point noise into fractional milliseconds. The client page contains one native `MediaStreamTrackProcessor` capture path and two independent manual tools; retain the route and catalog entry while removing anchors and server comparison state.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Vitest, WebCodecs `VideoFrame`, Media Capture APIs.

## Global Constraints

- Prefer `VideoFrame.metadata().captureTime` when it is finite and non-negative.
- Otherwise calculate an unverified approximation from `performance.timeOrigin + VideoFrame.timestamp / 1000`.
- Add exactly `2_208_988_800_000` milliseconds to convert Unix epoch milliseconds to NTP epoch milliseconds.
- The manual calculator supports explicit `captureTime` and `VideoFrame.timestamp` modes and never auto-detects the unit.
- The epoch converter supports explicit Unix → NTP and NTP → Unix directions in decimal milliseconds only.
- Preserve the converter input's fractional millisecond digits exactly; do not use floating-point arithmetic for its primary converted value.
- Copy actions copy only the decimal NTP epoch-millisecond value.
- Do not expose the old anchor, server matching, Q32.32, history table, or CSV interface.
- If `MediaStreamTrackProcessor` is unavailable, report unsupported instead of fabricating frame values.
- Keep `/test/ntp-capture-timestamp`, camera cleanup, and the existing test-page catalog entry.

---

## File Structure

- Create `lib/video-frame-ntp-calculator.ts`: pure formulas, input validation, result formatting, and live metadata selection.
- Create `lib/video-frame-ntp-calculator.test.ts`: unit tests for both formulas, preference order, invalid metadata, decimal inputs, and validation failures.
- Replace `app/test/ntp-capture-timestamp/page.tsx`: minimal native-frame capture UI, latest result, metadata display, and independent manual calculator.
- Modify `app/test/ntp-capture-timestamp/page.test.ts`: static page contract for the simplified interface and removed legacy UI.
- Modify `config/testPages.ts`: catalog description aligned with the simplified page.
- Modify `config/testPages.test.ts`: expected catalog description.

### Task 1: Pure VideoFrame-to-NTP Calculator

**Files:**
- Create: `lib/video-frame-ntp-calculator.ts`
- Create: `lib/video-frame-ntp-calculator.test.ts`

**Interfaces:**
- Consumes: numeric `performanceTimeOriginMs`, `captureTimeMs`, or `videoFrameTimestampUs`; unknown metadata values from `VideoFrame.metadata()`.
- Produces: `calculateNtpFromCaptureTime(performanceTimeOriginMs: number, captureTimeMs: number): NtpCalculationResult`.
- Produces: `calculateNtpFromVideoFrameTimestamp(performanceTimeOriginMs: number, videoFrameTimestampUs: number): NtpCalculationResult`.
- Produces: `calculateNtpFromFrame(input: LiveFrameCalculationInput): LiveFrameCalculationResult`.
- Produces: `parseCalculatorValue(value: string, label: string): number`.
- Produces: `formatTimestampMilliseconds(value: number): string`.

- [ ] **Step 1: Write failing unit tests for both formulas and live-frame selection**

```ts
import { describe, expect, it } from "vitest";
import {
  NTP_UNIX_EPOCH_OFFSET_MS,
  calculateNtpFromCaptureTime,
  calculateNtpFromFrame,
  calculateNtpFromVideoFrameTimestamp,
  formatTimestampMilliseconds,
  parseCalculatorValue,
} from "./video-frame-ntp-calculator";

describe("VideoFrame NTP calculator", () => {
  it("adds captureTime to timeOrigin and prefers it over VideoFrame.timestamp", () => {
    const result = calculateNtpFromFrame({
      performanceTimeOriginMs: 1_786_326_156_034.635,
      videoFrameTimestampUs: 106_574_320_365,
      metadata: { captureTime: 106_574_320.365 },
    });

    expect(result.method).toBe("capture-time");
    expect(result.confidence).toBe("preferred");
    expect(result.captureTimeMs).toBe(106_574_320.365);
    expect(result.unixTimestampMs).toBe(1_786_432_730_355);
    expect(result.ntpTimestampMs).toBe(3_995_421_530_355);
  });

  it.each([
    undefined,
    {},
    { captureTime: -1 },
    { captureTime: Number.NaN },
    { captureTime: "106574320.365" },
  ])("falls back for unavailable or invalid captureTime: %o", (metadata) => {
    const result = calculateNtpFromFrame({
      performanceTimeOriginMs: 1_786_326_156_034.635,
      videoFrameTimestampUs: 106_574_320_365,
      metadata,
    });

    expect(result.method).toBe("video-frame-timestamp");
    expect(result.confidence).toBe("unverified-approximation");
    expect(result.ntpTimestampMs).toBe(3_995_421_530_355);
  });

  it("uses milliseconds for captureTime", () => {
    expect(calculateNtpFromCaptureTime(1000.25, 20.5)).toMatchObject({
      unixTimestampMs: 1020.75,
      ntpTimestampMs: NTP_UNIX_EPOCH_OFFSET_MS + 1020.75,
    });
  });

  it("converts VideoFrame timestamp microseconds to milliseconds", () => {
    expect(calculateNtpFromVideoFrameTimestamp(1000.25, 20_500)).toMatchObject({
      unixTimestampMs: 1020.75,
      ntpTimestampMs: NTP_UNIX_EPOCH_OFFSET_MS + 1020.75,
    });
  });

  it.each(["", "-1", "NaN", "Infinity", "not-a-number"])(
    "rejects an invalid manual value: %s",
    (value) => expect(() => parseCalculatorValue(value, "timeOrigin")).toThrow(RangeError),
  );

  it("retains useful decimal precision when formatting", () => {
    expect(formatTimestampMilliseconds(3_995_421_530_355.365)).toBe("3995421530355.365");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails because the module is absent**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: FAIL with a module resolution error for `./video-frame-ntp-calculator`.

- [ ] **Step 3: Implement the pure calculator module**

```ts
export const NTP_UNIX_EPOCH_OFFSET_MS = 2_208_988_800_000;

export type NtpCalculationMethod = "capture-time" | "video-frame-timestamp";

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
  if (!Number.isFinite(ntpTimestampMs)) {
    throw new RangeError("calculated timestamp is outside the finite number range");
  }
  return {
    method,
    confidence: method === "capture-time" ? "preferred" : "unverified-approximation",
    unixTimestampMs,
    ntpTimestampMs,
    utcTimestamp: new Date(unixTimestampMs).toISOString(),
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
    videoFrameTimestampUs / 1000,
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
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : null;
  const result = captureTimeMs === null
    ? calculateNtpFromVideoFrameTimestamp(
        input.performanceTimeOriginMs,
        input.videoFrameTimestampUs,
      )
    : calculateNtpFromCaptureTime(input.performanceTimeOriginMs, captureTimeMs);
  return { ...result, captureTimeMs };
}

export function parseCalculatorValue(value: string, label: string): number {
  if (value.trim() === "") throw new RangeError(`${label} is required`);
  const parsed = Number(value);
  assertNonNegativeFinite(parsed, label);
  return parsed;
}

export function formatTimestampMilliseconds(value: number): string {
  assertNonNegativeFinite(value, "timestamp");
  return String(value);
}
```

- [ ] **Step 4: Run the new unit test and verify it passes**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: PASS for every test in the new file.

- [ ] **Step 5: Commit the pure calculator**

```bash
git add lib/video-frame-ntp-calculator.ts lib/video-frame-ntp-calculator.test.ts
git commit -m "feat: add VideoFrame NTP calculator"
```

### Task 2: Simplified Capture Page and Manual Calculator

**Files:**
- Replace: `app/test/ntp-capture-timestamp/page.tsx`
- Modify: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: all pure calculator exports created in Task 1.
- Produces: the existing default Next.js page component for `/test/ntp-capture-timestamp`.
- Produces: a latest-frame model containing raw timestamp, serializable metadata, metadata error, `performance.timeOrigin`, and `LiveFrameCalculationResult`.

- [ ] **Step 1: Replace the static page test with the simplified interface contract**

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NtpCaptureTimestampPage from "./page";

it("renders the simplified capture validator and manual calculator", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).toContain("NTP Capture Timestamp");
  expect(page).toContain("Start capture");
  expect(page).toContain("2. Calculate");
  expect(page).toContain("captureTime");
  expect(page).toContain("VideoFrame.timestamp");
  expect(page).toContain("Calculate NTP timestamp");
  expect(page).toContain("2208988800000");
  expect(page).toContain("Unverified approximation");
  expect(page).not.toContain("Manual server anchor");
  expect(page).not.toContain("Match tolerance");
  expect(page).not.toContain("Copy CSV");
});
```

- [ ] **Step 2: Run the page test and verify the old page fails the new contract**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because the old page lacks `Calculate NTP timestamp` and still renders removed comparison controls.

- [ ] **Step 3: Rewrite the page around native frame metadata and one latest result**

Implement these exact state and lifecycle boundaries:

```ts
type SerializableMetadata = Record<string, unknown>;

type VideoFrameLike = {
  timestamp: number;
  metadata?: () => unknown;
  close: () => void;
};

type LatestFrame = {
  videoFrameTimestampUs: number;
  performanceTimeOriginMs: number;
  metadata: SerializableMetadata;
  metadataError: string;
  calculation: LiveFrameCalculationResult;
};

type CalculatorMode = "capture-time" | "video-frame-timestamp";
```

The frame loop must call `frame.metadata()` inside its own `try/catch`, normalize a non-object result to `{}`, call `calculateNtpFromFrame`, update only `latestFrame`, and always invoke `frame.close()` in `finally`. A metadata failure sets `metadataError` and continues with `metadata: {}` so the helper uses the timestamp fallback.

The capture UI must include camera preview, API badges, start, stop, status, latest raw timestamp, full metadata JSON, selected method, Unix milliseconds, emphasized NTP milliseconds, UTC, formula expression, confidence notice, and a button that copies the latest NTP value. Do not keep arrays of frames or any anchor/server state.

If `window.MediaStreamTrackProcessor` is unavailable, `startCapture` must set an unsupported error and must not invoke `requestVideoFrameCallback` or a timer fallback.

- [ ] **Step 4: Add the independent two-mode manual calculator**

Use separate strings for `manualTimeOrigin`, `manualCaptureTime`, and `manualFrameTimestamp`, plus `calculatorMode`, `manualResult`, and `manualError`. Seed `manualTimeOrigin` from `performance.timeOrigin` after mount when it is blank; use `106574320.365` as the initial capture-time example and `106574320365` as the initial frame-timestamp example.

On submit:

```ts
const timeOrigin = parseCalculatorValue(manualTimeOrigin, "performance.timeOrigin");
const result = calculatorMode === "capture-time"
  ? calculateNtpFromCaptureTime(
      timeOrigin,
      parseCalculatorValue(manualCaptureTime, "captureTime"),
    )
  : calculateNtpFromVideoFrameTimestamp(
      timeOrigin,
      parseCalculatorValue(manualFrameTimestamp, "VideoFrame.timestamp"),
    );
```

Changing modes must clear `manualResult` and `manualError` but retain all three input strings. Render only the mode-relevant timestamp input, the exact formula, an explicit calculate button, validation error, Unix milliseconds, primary NTP milliseconds, UTC, substituted expression, and an NTP-only copy button. Always render the yellow `Unverified approximation` notice while frame-timestamp mode is selected.

- [ ] **Step 5: Run focused helper and page tests**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts app/test/ntp-capture-timestamp/page.test.ts`

Expected: PASS for both files.

- [ ] **Step 6: Commit the simplified page**

```bash
git add app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts
git commit -m "feat: simplify VideoFrame NTP test page"
```

### Task 3: Catalog Copy, Regression Verification, and Deployment

**Files:**
- Modify: `config/testPages.ts`
- Modify: `config/testPages.test.ts`

**Interfaces:**
- Consumes: existing `testPages` catalog structure.
- Produces: description `Calculate NTP timestamps from VideoFrame metadata or timestamp` for the unchanged `ntp-capture-timestamp` route.

- [ ] **Step 1: Update the catalog test to require the new description**

Add this property to the existing expected object for `ntp-capture-timestamp`:

```ts
description: "Calculate NTP timestamps from VideoFrame metadata or timestamp",
```

- [ ] **Step 2: Run the catalog test and verify it fails on the old description**

Run: `npm test -- config/testPages.test.ts`

Expected: FAIL because the implementation still says it compares Q32.32 values.

- [ ] **Step 3: Change only the catalog description**

```ts
description: "Calculate NTP timestamps from VideoFrame metadata or timestamp",
```

- [ ] **Step 4: Run the catalog test and verify it passes**

Run: `npm test -- config/testPages.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the complete automated verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: Next.js production build exits `0` and lists `/test/ntp-capture-timestamp`.

- [ ] **Step 6: Commit catalog copy and verified integration**

```bash
git add config/testPages.ts config/testPages.test.ts
git commit -m "docs: update NTP calculator catalog copy"
```

- [ ] **Step 7: Push main to trigger the connected Vercel production deployment**

Run: `git status --short --branch`

Expected: clean `main` ahead of `origin/main` by the implementation commits.

Run: `git push origin main`

Expected: the push succeeds and updates `origin/main` to the local `main` commit.

- [ ] **Step 8: Verify the deployed production route**

Use the deployment URL returned by the connected Vercel/GitHub deployment, open `/test/ntp-capture-timestamp`, and verify the page returns successfully and shows `Calculate NTP timestamp`, both calculator modes, and no manual-anchor controls.

### Task 4: Unix/NTP Epoch-Millisecond Converter

**Files:**
- Modify: `lib/video-frame-ntp-calculator.ts`
- Modify: `lib/video-frame-ntp-calculator.test.ts`
- Modify: `app/test/ntp-capture-timestamp/page.tsx`
- Modify: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: a decimal-millisecond input string and explicit `EpochConversionDirection`.
- Produces: `convertEpochMilliseconds(value: string, direction: EpochConversionDirection): EpochConversionResult`.
- Preserves: the exact fractional digits supplied by the user in `sourceTimestampMs` and `convertedTimestampMs`.
- Produces: an independent page card with its own direction, two retained input strings, result, error, and copy feedback.

- [ ] **Step 1: Add failing unit tests for both conversion directions and validation**

Append these imports and tests to `lib/video-frame-ntp-calculator.test.ts`:

```ts
import { convertEpochMilliseconds } from "./video-frame-ntp-calculator";

describe("Unix/NTP epoch converter", () => {
  it("adds the epoch offset without losing fractional millisecond digits", () => {
    expect(
      convertEpochMilliseconds("1786432730355.365", "unix-to-ntp"),
    ).toMatchObject({
      direction: "unix-to-ntp",
      sourceTimestampMs: "1786432730355.365",
      convertedTimestampMs: "3995421530355.365",
      unixTimestampMs: "1786432730355.365",
      utcTimestamp: "2026-08-11T07:18:50.355Z",
      expression:
        "1786432730355.365 + 2208988800000 = 3995421530355.365",
    });
  });

  it("subtracts the epoch offset without floating-point noise", () => {
    expect(
      convertEpochMilliseconds("3995421530355.365", "ntp-to-unix"),
    ).toMatchObject({
      direction: "ntp-to-unix",
      sourceTimestampMs: "3995421530355.365",
      convertedTimestampMs: "1786432730355.365",
      unixTimestampMs: "1786432730355.365",
      expression:
        "3995421530355.365 - 2208988800000 = 1786432730355.365",
    });
  });

  it("preserves trailing fractional zeros", () => {
    expect(
      convertEpochMilliseconds("1.2300", "unix-to-ntp").convertedTimestampMs,
    ).toBe("2208988800001.2300");
  });

  it.each(["", "-1", ".5", "NaN", "Infinity", "not-a-time"])(
    "rejects a malformed epoch value: %s",
    (value) => {
      expect(() => convertEpochMilliseconds(value, "unix-to-ntp")).toThrow(
        RangeError,
      );
    },
  );

  it("rejects an NTP value before the supported Unix epoch", () => {
    expect(() =>
      convertEpochMilliseconds("2208988799999.999", "ntp-to-unix"),
    ).toThrow("before the supported Unix epoch");
  });
});
```

- [ ] **Step 2: Run the helper test and verify the new API is absent**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: FAIL because `convertEpochMilliseconds` is not exported.

- [ ] **Step 3: Implement exact decimal-string epoch conversion**

Add to `lib/video-frame-ntp-calculator.ts`:

```ts
export type EpochConversionDirection = "unix-to-ntp" | "ntp-to-unix";

export interface EpochConversionResult {
  direction: EpochConversionDirection;
  sourceTimestampMs: string;
  convertedTimestampMs: string;
  unixTimestampMs: string;
  utcTimestamp: string;
  expression: string;
}

function parseDecimalMilliseconds(value: string, label: string) {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new RangeError(`${label} must be a non-negative decimal millisecond value`);
  }
  const whole = BigInt(match[1]);
  const fraction = match[2] ?? "";
  const normalizedWhole = whole.toString();
  return {
    whole,
    fraction,
    normalized: fraction ? `${normalizedWhole}.${fraction}` : normalizedWhole,
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
  const unixDate = new Date(Number(unixTimestampMs));
  if (!Number.isFinite(Number(unixTimestampMs)) || Number.isNaN(unixDate.getTime())) {
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
```

- [ ] **Step 4: Run the helper test and verify all calculator tests pass**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: PASS, including exact `.365` and `.2300` output assertions.

- [ ] **Step 5: Extend the page test with the second calculator contract**

Add these assertions to `app/test/ntp-capture-timestamp/page.test.ts`:

```ts
expect(page).toContain("Unix ↔ NTP epoch converter");
expect(page).toContain("Unix → NTP");
expect(page).toContain("NTP → Unix");
expect(page).toContain("Convert timestamp");
expect(page).toContain("1786432730355.365");
```

- [ ] **Step 6: Run the page test and verify the converter UI is absent**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because the page does not yet render `Unix ↔ NTP epoch converter`.

- [ ] **Step 7: Add the independent Unix/NTP converter card**

Import `EpochConversionDirection`, `EpochConversionResult`, and `convertEpochMilliseconds`. Add independent state:

```ts
const [epochDirection, setEpochDirection] =
  useState<EpochConversionDirection>("unix-to-ntp");
const [manualUnixTimestamp, setManualUnixTimestamp] =
  useState("1786432730355.365");
const [manualNtpTimestamp, setManualNtpTimestamp] =
  useState("3995421530355.365");
const [epochResult, setEpochResult] = useState<EpochConversionResult | null>(null);
const [epochError, setEpochError] = useState("");
const [epochCopyLabel, setEpochCopyLabel] = useState("Copy converted timestamp");
```

Render a second card within section `2. Calculate` after the VideoFrame calculator. It must render two explicit direction radios, only the selected direction's input, the exact formula, `Convert timestamp`, validation error, source value, emphasized converted value, UTC, substituted expression, and a copy button. Direction changes clear `epochResult`, `epochError`, and copy feedback while retaining both input strings. Submit calls:

```ts
const input = epochDirection === "unix-to-ntp"
  ? manualUnixTimestamp
  : manualNtpTimestamp;
setEpochResult(convertEpochMilliseconds(input, epochDirection));
```

Copy `epochResult.convertedTimestampMs` only.

- [ ] **Step 8: Run focused tests, full tests, and production build**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts app/test/ntp-capture-timestamp/page.test.ts`

Expected: focused tests pass.

Run: `npm test`

Expected: all test files pass.

Run: `npm run build`

Expected: production build exits `0` and includes `/test/ntp-capture-timestamp`.

- [ ] **Step 9: Commit and deploy the converter**

```bash
git add lib/video-frame-ntp-calculator.ts lib/video-frame-ntp-calculator.test.ts app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts
git commit -m "feat: add Unix NTP epoch converter"
git push origin main
```

Verify the production route shows `Unix ↔ NTP epoch converter` and that the sample converts exactly between `1786432730355.365` and `3995421530355.365`.
