# Local Camera VideoFrame NTP Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invalid direct `timeOrigin + VideoFrame.timestamp` fallback with a local-camera clock anchor and let the user select timestamp anchoring or capture-time preference.

**Architecture:** Keep timestamp calculations in `lib/video-frame-ntp-calculator.ts`. A pure `FrameClockAnchor` maintains a bounded offset window so the React page can sample it once for each native frame and render a result without embedding time math. The page exposes one strategy selector for the live camera and matching manual-calculator modes.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Tailwind CSS.

## Global Constraints

- Local camera tracks only; do not add WebRTC sender/RTCP mapping.
- Keep values in decimal NTP-epoch milliseconds, not Q32.32 wire format.
- Use `performance.timeOrigin + performance.now()` only for a navigation-time local wall-clock projection.
- Never restore the direct `timeOrigin + VideoFrame.timestamp / 1000` formula.
- The anchor window contains exactly 64 most-recent samples and resets on timestamp discontinuity.

---

### Task 1: Add pure timestamp-anchor calculations

**Files:**
- Modify: `lib/video-frame-ntp-calculator.ts`
- Test: `lib/video-frame-ntp-calculator.test.ts`

**Interfaces:**
- Produces: `FrameTimestampStrategy = "prefer-capture-time" | "timestamp-anchor"`.
- Produces: `FrameClockAnchor` with `observe(videoFrameTimestampUs: number, wallProjectionMs: number): FrameClockAnchorObservation` and `reset(): void`.
- Produces: `calculateNtpFromTimestampAnchor(videoFrameTimestampUs: number, anchorOffsetMs: number, sampleCount: number, observedDelayMs: number): NtpCalculationResult`.
- Changes: `calculateNtpFromFrame(input)` accepts `strategy` and an optional anchor observation.

- [ ] **Step 1: Write the failing tests**

```ts
it("uses a recent-window minimum offset to anchor VideoFrame.timestamp", () => {
  const anchor = new FrameClockAnchor();
  anchor.observe(2_505_600_000_000, 1_786_524_400_010);
  const observation = anchor.observe(2_505_600_033_333, 1_786_524_400_060);

  expect(observation).toMatchObject({
    anchorOffsetMs: 1_784_018_800_010,
    sampleCount: 2,
    observedDelayMs: 16.667,
  });
});

it("uses captureTime only with the preferred strategy", () => {
  const input = {
    performanceTimeOriginMs: 1_786_326_156_034.635,
    wallProjectionMs: 1_786_432_730_355,
    videoFrameTimestampUs: 106_574_320_365,
    metadata: { captureTime: 106_574_320.365 },
  };

  expect(calculateNtpFromFrame({ ...input, strategy: "prefer-capture-time" }).method)
    .toBe("capture-time");
  expect(calculateNtpFromFrame({ ...input, strategy: "timestamp-anchor" }).method)
    .toBe("timestamp-anchor");
});

it("resets an anchor when a timestamp jumps forward by more than five seconds", () => {
  const anchor = new FrameClockAnchor();
  anchor.observe(1_000_000, 5_000);

  expect(anchor.observe(7_000_001, 11_000).wasReset).toBe(true);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: FAIL because `FrameClockAnchor` and the timestamp-anchor strategy do not yet exist.

- [ ] **Step 3: Implement the minimal pure anchor API**

```ts
export class FrameClockAnchor {
  private offsetsMs: number[] = [];
  private previousTimestampUs: number | null = null;

  observe(videoFrameTimestampUs: number, wallProjectionMs: number) {
    const wasReset = this.isDiscontinuous(videoFrameTimestampUs);
    if (wasReset) this.reset();
    const offsetMs = wallProjectionMs - videoFrameTimestampUs / 1_000;
    this.offsetsMs.push(offsetMs);
    if (this.offsetsMs.length > 64) this.offsetsMs.shift();
    this.previousTimestampUs = videoFrameTimestampUs;
    const anchorOffsetMs = Math.min(...this.offsetsMs);
    return {
      anchorOffsetMs,
      sampleCount: this.offsetsMs.length,
      observedDelayMs: offsetMs - anchorOffsetMs,
      wasReset,
    };
  }
}
```

Return an NTP result whose expression contains the anchor offset and whose method is `timestamp-anchor`; retain the existing capture-time result and epoch converter unchanged.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: PASS with all calculator tests green.

- [ ] **Step 5: Commit the pure calculation change**

```bash
git add lib/video-frame-ntp-calculator.ts lib/video-frame-ntp-calculator.test.ts
git commit -m "feat: anchor local VideoFrame timestamps"
```

### Task 2: Add strategy selection and anchored live-frame rendering

**Files:**
- Modify: `app/test/ntp-capture-timestamp/page.tsx`
- Test: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: `FrameClockAnchor`, `FrameTimestampStrategy`, `calculateNtpFromFrame`, and `FrameClockAnchorObservation` from Task 1.
- Produces: selectable live-capture strategy and a live-frame result carrying `anchorOffsetMs`, `sampleCount`, and `observedDelayMs` for anchored calculations.

- [ ] **Step 1: Write the failing page-level tests**

```ts
it("renders both local-camera timestamp strategies", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).toContain("Prefer metadata.captureTime");
  expect(page).toContain("Use VideoFrame.timestamp anchor");
});

it("does not render the invalid direct timeOrigin timestamp formula", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).not.toContain("timeOrigin + VideoFrame.timestamp / 1000");
});
```

- [ ] **Step 2: Run the targeted page test to verify it fails**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because the two strategy labels and the anchored formula are absent.

- [ ] **Step 3: Implement the live strategy selector and anchor lifecycle**

```tsx
const anchorRef = useRef(new FrameClockAnchor());
const [timestampStrategy, setTimestampStrategy] =
  useState<FrameTimestampStrategy>("prefer-capture-time");

const observation = anchorRef.current.observe(
  value.timestamp,
  performance.timeOrigin + performance.now(),
);
const calculation = calculateNtpFromFrame({
  performanceTimeOriginMs: performance.timeOrigin,
  videoFrameTimestampUs: value.timestamp,
  metadata: rawMetadata,
  strategy: timestampStrategy,
  anchorObservation: observation,
});
```

Reset the anchor before a new capture begins, after stopping, and when the strategy changes. Replace all old “unverified approximation” copy with a local-clock-anchor explanation. Display the selected strategy, anchor sample count, anchor offset, and observed extra delay in the latest-frame panel.

- [ ] **Step 4: Add matching manual calculator modes**

```tsx
{calculatorMode === "timestamp-anchor" ? (
  <>
    <label>VideoFrame.timestamp (µs)<input /* existing state */ /></label>
    <label>Observed wall projection (ms)<input /* new state */ /></label>
  </>
) : null}
```

Use `calculateNtpFromTimestampAnchor` with the one-sample offset `observedWallProjectionMs - videoFrameTimestampUs / 1000`. Label it as a one-sample demonstration and state that live capture uses a rolling 64-sample minimum.

- [ ] **Step 5: Run the targeted page test to verify it passes**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: PASS and no UI text refers to the invalid direct formula.

- [ ] **Step 6: Commit the page change**

```bash
git add app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts
git commit -m "feat: select local VideoFrame timestamp strategy"
```

### Task 3: Verify and publish the completed page

**Files:**
- Verify: `lib/video-frame-ntp-calculator.test.ts`
- Verify: `app/test/ntp-capture-timestamp/page.tsx`
- Verify: `app/test/ntp-capture-timestamp/page.test.ts`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS with zero test failures.

- [ ] **Step 2: Run lint and the production build**

Run: `npm run lint && npm run build`

Expected: both commands exit 0 and Next.js lists `/test/ntp-capture-timestamp` in the build output.

- [ ] **Step 3: Inspect the final diff and commit the design documents**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the calculator, page, tests, specification, and plan are changed.

```bash
git add docs/superpowers/specs/2026-08-12-local-camera-ntp-anchor-design.md docs/superpowers/plans/2026-08-12-local-camera-ntp-anchor.md
git commit -m "docs: specify local VideoFrame NTP anchoring"
```

- [ ] **Step 4: Push `main` and verify deployment**

Run: `git push origin main`

Expected: the remote accepts the new commits. Open `/test/ntp-capture-timestamp`, choose each strategy, and confirm the live result reports either capture time or timestamp anchoring as selected.
