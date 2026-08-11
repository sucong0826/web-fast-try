# VideoFrame-to-NTP Strategy Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing NTP capture page so engineers can compare four VideoFrame-to-NTP mappings against server timestamps in either NTP epoch-millisecond or standard Q32.32 format.

**Architecture:** Keep camera ownership and presentation in the existing client page, but move timestamp normalization and strategy arithmetic into a pure TypeScript module. Store each captured frame with the four derived results and its observation clocks, normalize pasted server timestamps into NTP-epoch microseconds, and compare every strategy on a common integer timebase.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Vitest, WebCodecs `VideoFrame`, Media Capture APIs, JavaScript `BigInt`.

## Global Constraints

- Keep route `/test/ntp-capture-timestamp`, the existing camera lifecycle, diagnostics, CSV export, and 200-row limit.
- Do not add runtime dependencies or contact an external time service.
- Support explicit server formats `epoch-ms` and `q32.32`; do not auto-detect by magnitude.
- Label mappings without server/RTCP clock correlation as estimates.
- Use `BigInt` for NTP normalization and Q32.32 arithmetic.
- Mark the time-origin strategy plausible only when `abs(frameTimestampUs / 1000 - performance.now()) <= 5000`.

---

### Task 1: Timestamp normalization and conversion strategies

**Files:**
- Create: `lib/video-frame-ntp.ts`
- Create: `lib/video-frame-ntp.test.ts`
- Modify: `lib/ntp-timestamp.ts`
- Modify: `lib/ntp-timestamp.test.ts`

**Interfaces:**
- Produces: `type ServerNtpFormat = "epoch-ms" | "q32.32"`
- Produces: `type ClientFrameAnchor = { frameTimestampUs: number; unixEpochUs: number }`
- Produces: `type ServerFrameAnchor = { frameTimestampUs: number; ntpEpochUs: bigint }`
- Produces: `parseNtpEpochMilliseconds(value: string): bigint`
- Produces: `formatNtpEpochMilliseconds(ntpEpochUs: bigint): string`
- Produces: `q32_32ToNtpEpochUs(value: string): bigint`
- Produces: `ntpEpochUsToQ32_32(ntpEpochUs: bigint): string`
- Produces: `normalizeServerNtpTimestamp(value: string, format: ServerNtpFormat): bigint`
- Produces: `calculateFrameTimestampStrategies(input): FrameTimestampStrategies`

- [ ] **Step 1: Add failing format-conversion tests**

Add tests that require exact parsing/formatting and Q32.32 round trips:

```ts
expect(parseNtpEpochMilliseconds("3995421530355")).toBe(
  3995421530355000n,
);
expect(formatNtpEpochMilliseconds(3995421530355000n)).toBe(
  "3995421530355",
);
expect(formatNtpEpochMilliseconds(3995421530355365n)).toBe(
  "3995421530355.365",
);

const q32 = ntpEpochUsToQ32_32(3995421530355000n);
expect(q32_32ToNtpEpochUs(q32)).toBe(3995421530355000n);
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run: `npm test -- lib/ntp-timestamp.test.ts lib/video-frame-ntp.test.ts`

Expected: FAIL because the new module and exports do not exist.

- [ ] **Step 3: Implement exact NTP representation helpers**

Use these constants and integer relationships:

```ts
const MICROSECONDS_PER_SECOND = 1_000_000n;
const MICROSECONDS_PER_MILLISECOND = 1_000n;
const NTP_FRACTION_SCALE = 1n << 32n;

export function ntpEpochUsToQ32_32(ntpEpochUs: bigint): string {
  const seconds = ntpEpochUs / MICROSECONDS_PER_SECOND;
  const fractionUs = ntpEpochUs % MICROSECONDS_PER_SECOND;
  const fraction =
    (fractionUs * NTP_FRACTION_SCALE + MICROSECONDS_PER_SECOND / 2n) /
    MICROSECONDS_PER_SECOND;
  return ((seconds << 32n) | (fraction & 0xffffffffn)).toString();
}

export function q32_32ToNtpEpochUs(value: string): bigint {
  const timestamp = BigInt(value);
  const seconds = timestamp >> 32n;
  const fraction = timestamp & 0xffffffffn;
  return (
    seconds * MICROSECONDS_PER_SECOND +
    (fraction * MICROSECONDS_PER_SECOND + NTP_FRACTION_SCALE / 2n) /
      NTP_FRACTION_SCALE
  );
}
```

Parse epoch milliseconds with a decimal-string regular expression, accept at most three fractional millisecond digits, and return integer microseconds. Format integer microseconds without trailing fractional zeroes. Reject negative or malformed inputs with `RangeError`.

- [ ] **Step 4: Add failing strategy tests**

Define one input fixture:

```ts
const strategies = calculateFrameTimestampStrategies({
  frameTimestampUs: 106574320365,
  observedUnixEpochUs: 1786432730355000,
  performanceTimeOriginMs: 1786326156034.635,
  performanceNowMs: 106574320.365,
  clientAnchor: {
    frameTimestampUs: 106574320365,
    unixEpochUs: 1786432730355000,
  },
  serverAnchor: {
    frameTimestampUs: 106574320365,
    ntpEpochUs: 3995421530355000n,
  },
});

expect(strategies.naiveUnixEpochUs).toBe(106574320365n);
expect(strategies.timeOriginUnixEpochUs).toBe(1786432730355000n);
expect(strategies.clientAnchorUnixEpochUs).toBe(1786432730355000n);
expect(strategies.manualServerNtpEpochUs).toBe(3995421530355000n);
expect(strategies.performanceDeltaMs).toBe(0);
expect(strategies.timeOriginPlausible).toBe(true);
```

Add a second fixture with `performanceNowMs: 1` and expect `timeOriginPlausible` to be false. Add a later frame at `106574353698` and expect the manual NTP result to advance by `33333n` microseconds.

- [ ] **Step 5: Implement the four pure strategies**

Return this exact shape:

```ts
export interface FrameTimestampStrategies {
  naiveUnixEpochUs: bigint;
  timeOriginUnixEpochUs: bigint;
  clientAnchorUnixEpochUs: bigint;
  manualServerNtpEpochUs: bigint | null;
  performanceDeltaMs: number;
  timeOriginPlausible: boolean;
}
```

Calculate Unix microseconds by rounding millisecond expressions to the nearest microsecond. Calculate anchor deltas from the integer frame timestamps. Return `null` for the manual strategy when no server anchor is supplied.

- [ ] **Step 6: Run focused tests and commit the utility layer**

Run: `npm test -- lib/ntp-timestamp.test.ts lib/video-frame-ntp.test.ts`

Expected: all focused tests PASS.

Commit:

```bash
git add lib/ntp-timestamp.ts lib/ntp-timestamp.test.ts lib/video-frame-ntp.ts lib/video-frame-ntp.test.ts
git commit -m "feat: add VideoFrame NTP conversion strategies"
```

---

### Task 2: Interactive strategy comparison page

**Files:**
- Modify: `app/test/ntp-capture-timestamp/page.tsx`
- Modify: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: all exports from `lib/video-frame-ntp.ts`
- Preserves: `MediaStreamTrackProcessor`, `requestVideoFrameCallback`, timer fallback, `MAX_ROWS = 200`, camera cleanup, diagnostics, and CSV export
- Produces: capture clock readout, four strategy cards, explicit server-format selector, manual anchor controls, per-strategy result table, and normalized server-error comparison

- [ ] **Step 1: Extend the render test first**

Require the static page markup to contain the new controls and explanations:

```ts
const markup = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

expect(markup).toContain("Naive Unix interpretation");
expect(markup).toContain("Performance timeOrigin");
expect(markup).toContain("Client first-frame anchor");
expect(markup).toContain("Manual server anchor");
expect(markup).toContain("NTP epoch milliseconds");
expect(markup).toContain("NTP Q32.32");
expect(markup).toContain("106574320365");
expect(markup).toContain("3995421530355");
```

- [ ] **Step 2: Run the page test and confirm the red state**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because the strategy and format controls are absent.

- [ ] **Step 3: Replace the single-estimate row model**

Each capture records:

```ts
type CaptureRow = {
  id: number;
  frameTimestampUs: number;
  observedUnixEpochUs: number;
  performanceTimeOriginMs: number;
  performanceNowMs: number;
  source: string;
  strategies: FrameTimestampStrategies;
};
```

When the first native frame is observed, create the existing client anchor. For every frame, take `performance.now()` and `Date.now()` in the same callback, then call `calculateFrameTimestampStrategies`. Recalculate rows when the manual server anchor changes so pasted reference data can be tested without restarting capture.

- [ ] **Step 4: Add explicit server normalization and anchor controls**

Add state for:

```ts
const [serverFormat, setServerFormat] = useState<ServerNtpFormat>("epoch-ms");
const [referenceFrameTimestampUs, setReferenceFrameTimestampUs] = useState("106574320365");
const [referenceServerNtp, setReferenceServerNtp] = useState("3995421530355");
```

Normalize pasted values and the reference NTP value with `normalizeServerNtpTimestamp`. Show inline validation errors instead of throwing from event handlers. Add a captured-row action that copies its raw timestamp into the reference-frame field.

- [ ] **Step 5: Render live clock diagnostics and four strategy cards**

Show the latest raw timestamp, `performance.timeOrigin`, observation `performance.now()`, observation `Date.now()`, and the shared-origin delta. Each strategy card must show:

- the formula;
- NTP epoch milliseconds;
- Q32.32 decimal form;
- UTC output derived from Unix time when meaningful;
- a confidence badge: `invalid unless guaranteed`, `plausible/unverified`, `estimate`, or `reference mapped`.

The naive card must display the expected 1973 date for sample value `106574320365`, making the failure mode visible.

- [ ] **Step 6: Expand comparison and CSV output**

Normalize server values to NTP-epoch microseconds. Compare each strategy's NTP result with the nearest server value using absolute integer microsecond differences, rendered as milliseconds. Include raw clocks, all four NTP epoch-millisecond results, all four Q32.32 results, plausibility, nearest server index, and error in CSV output.

- [ ] **Step 7: Run focused page and utility tests**

Run:

```bash
npm test -- app/test/ntp-capture-timestamp/page.test.ts lib/video-frame-ntp.test.ts lib/ntp-timestamp.test.ts
```

Expected: all focused tests PASS with no React server-render warnings.

- [ ] **Step 8: Commit the page enhancement**

```bash
git add app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts
git commit -m "feat: compare VideoFrame NTP mapping strategies"
```

---

### Task 3: Regression and production verification

**Files:**
- Modify only files from Tasks 1-2 if verification exposes a defect

**Interfaces:**
- Verifies: all timestamp helpers, static rendering, existing test-page catalog, and production Next.js compilation

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Next.js production build exits 0 and includes `/test/ntp-capture-timestamp`.

- [ ] **Step 3: Perform manual browser validation**

Run: `npm run dev`, open `/test/ntp-capture-timestamp`, grant camera permission, and verify:

- native `VideoFrame.timestamp` rows appear when supported;
- stop releases the camera;
- all four strategy cards update;
- format switching changes parsing without auto-detection;
- the sample manual anchor maps `106574320365` to `3995421530355`;
- a later frame advances by its timestamp delta;
- malformed server input shows an inline error;
- CSV copy includes every strategy.

- [ ] **Step 4: Inspect the final diff and status**

Run:

```bash
git diff --check
git status --short
git log -5 --oneline
```

Expected: no whitespace errors, only intentional files changed, and both implementation commits are present after the plan/design commits.
