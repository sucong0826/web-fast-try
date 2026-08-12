# NTP Page Information Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show UTC and browser-local interpretations of NTP results, move Latest native frame before the calculators, and collapse low-priority diagnostics.

**Architecture:** Add a small pure formatter to the existing calculator library so every result view consumes the same browser-local time-zone data. Keep capture behavior unchanged; reorganize only the test-page presentation, using native `details` for optional diagnostics and the epoch converter.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Tailwind CSS, `Intl.DateTimeFormat`.

## Global Constraints

- Keep decimal Unix/NTP epoch values and all capture-time and timestamp-anchor behavior unchanged.
- Use the browser's resolved time zone; do not add a fixed or user-selectable time zone.
- Keep UTC visible for every calculated result and preserve millisecond precision in local time.
- Use native `details`/`summary` for collapsed sections.
- The displayed order is Capture, Latest native frame, Calculate.

---

### Task 1: Add browser-local timestamp formatting

**Files:**
- Modify: `lib/video-frame-ntp-calculator.ts`
- Test: `lib/video-frame-ntp-calculator.test.ts`

**Interfaces:**
- Produces: `LocalTimestampInterpretation` with `timeZone: string` and `display: string`.
- Produces: `formatLocalTimestamp(unixTimestampMs: number, options?: { locales?: string | string[]; timeZone?: string }): LocalTimestampInterpretation`.

- [ ] **Step 1: Write the failing formatting test**

```ts
it("formats a Unix timestamp in a supplied browser time zone with milliseconds", () => {
  const result = formatLocalTimestamp(1_786_525_630_036, {
    locales: "en-GB",
    timeZone: "Asia/Shanghai",
  });

  expect(result.timeZone).toBe("Asia/Shanghai");
  expect(result.display).toMatch(/17:07:10\.036/);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: FAIL because `formatLocalTimestamp` is not exported.

- [ ] **Step 3: Implement the pure formatter**

```ts
export function formatLocalTimestamp(unixTimestampMs: number, options = {}) {
  assertNonNegativeFinite(unixTimestampMs, "Unix timestamp");
  const formatter = new Intl.DateTimeFormat(options.locales, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, timeZoneName: "short",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  return {
    timeZone: options.timeZone ?? formatter.resolvedOptions().timeZone,
    display: formatter.format(new Date(unixTimestampMs)),
  };
}
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: PASS with all calculator tests green.

- [ ] **Step 5: Commit the formatter**

Run: `git add lib/video-frame-ntp-calculator.ts lib/video-frame-ntp-calculator.test.ts && git commit -m "feat: format NTP results in browser time zone"`

### Task 2: Prioritize results and collapse diagnostics

**Files:**
- Modify: `app/test/ntp-capture-timestamp/page.tsx`
- Test: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: `formatLocalTimestamp` from Task 1.
- Produces: `TimestampInterpretations`, accepting `unixTimestampMs: number` and `utcTimestamp: string`.
- Produces: disclosure summaries `Show diagnostics` and `Epoch converter`.

- [ ] **Step 1: Write the failing static page test**

```ts
it("places latest frame before calculators and collapses secondary details", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page.indexOf("1. Capture")).toBeLessThan(page.indexOf("2. Latest native frame"));
  expect(page.indexOf("2. Latest native frame")).toBeLessThan(page.indexOf("3. Calculate"));
  expect(page).toContain("Browser local time");
  expect(page).toContain("Show diagnostics");
  expect(page).toContain("Epoch converter");
});
```

- [ ] **Step 2: Run the targeted page test to verify it fails**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because Latest native frame currently follows Calculate and the two disclosures do not exist.

- [ ] **Step 3: Add shared UTC and browser-local result presentation**

```tsx
function TimestampInterpretations({ unixTimestampMs, utcTimestamp }: Props) {
  const local = formatLocalTimestamp(unixTimestampMs);
  return (
    <dl>
      <div><dt>UTC interpretation</dt><dd>{utcTimestamp}</dd></div>
      <div><dt>Browser local time ({local.timeZone})</dt><dd>{local.display}</dd></div>
    </dl>
  );
}
```

Use this component in both result views, converting the epoch converter's validated decimal Unix value with `Number(result.unixTimestampMs)`.

- [ ] **Step 4: Reorder sections and add disclosures**

Move Latest native frame immediately after Capture and rename it `2. Latest native frame`. Keep NTP/Unix values, UTC/local interpretations, applied method, and copy action visible. Move raw source fields, anchor diagnostics, expression, metadata, and errors inside:

```tsx
<details className="mt-5 rounded-xl border ...">
  <summary className="cursor-pointer ...">Show diagnostics</summary>
  {/* diagnostic cards and metadata */}
</details>
```

Move Calculate after this section and rename it `3. Calculate`. Wrap the Unix/NTP converter inside:

```tsx
<details className="mt-8 border-t ...">
  <summary className="cursor-pointer ...">Epoch converter</summary>
  {/* converter form and result */}
</details>
```

- [ ] **Step 5: Run the targeted page test to verify it passes**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: PASS with the new order and disclosures rendered.

- [ ] **Step 6: Commit the page hierarchy**

Run: `git add app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts && git commit -m "feat: prioritize NTP frame results"`

### Task 3: Verify and publish

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-ntp-page-information-hierarchy-design.md`
- Create: `docs/superpowers/plans/2026-08-12-ntp-page-information-hierarchy.md`

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 2: Run lint and production build**

Run: `npm run lint && npm run build`

Expected: both commands exit 0 and `/test/ntp-capture-timestamp` appears in the build routes.

- [ ] **Step 3: Commit documentation and corrected formatter options**

Run: `git diff --check && git status --short`

Expected: no whitespace errors.

Run: `git add docs/superpowers/specs/2026-08-12-ntp-page-information-hierarchy-design.md docs/superpowers/plans/2026-08-12-ntp-page-information-hierarchy.md && git commit -m "docs: plan NTP page hierarchy"`

- [ ] **Step 4: Push and verify the public page**

Run: `git push origin main`

Expected: `origin/main` receives the commits. Confirm the public page contains `Browser local time`, `Show diagnostics`, and `Epoch converter`.
