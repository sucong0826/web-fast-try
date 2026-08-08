# NTP Capture Timestamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native browser test page that captures camera-frame timestamps, encodes them as Q32.32 NTP timestamps, and compares them with pasted server values.

**Architecture:** Put NTP arithmetic in a framework-independent TypeScript utility with Vitest coverage. A client-only App Router page owns feature detection, camera lifecycle, result rows, clipboard export, and a responsive test UI.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Vitest, Media Capture APIs.

## Global Constraints

- Route: `/test/ntp-capture-timestamp`; title: `NTP Capture Timestamp`; category: `Debug`.
- Do not add runtime dependencies.
- Prefer `MediaStreamTrackProcessor`; every fallback is visibly labeled as a JavaScript-time estimate.
- Preserve Q32.32 NTP values as decimal strings and use `BigInt` for arithmetic and comparison.
- Surface camera, clipboard, and unsupported-API errors in diagnostics.
- Follow the existing test layout with light cards and restrained blue-violet accents.

---

### Task 1: NTP utility and catalog entry

**Files:**
- Create: `lib/ntp-timestamp.ts`
- Create: `lib/ntp-timestamp.test.ts`
- Modify: `config/testPages.ts`
- Modify: `config/testPages.test.ts`

**Interfaces:**
- Produces: `unixEpochUsToNtpTimestamp(unixEpochUs: number): string`
- Produces: `ntpTimestampToParts(ntpTimestamp: string): { seconds: string; fraction: string }`
- Produces: `findNearestNtpTimestamp(serverTimestamps: readonly string[], targetTimestamp: string, toleranceMs: number): { index: number | null; diffMs: number | null; matched: boolean }`
- Produces: `parseNtpTimestampList(text: string): string[]`
- Produces: catalog entry `{ id: "ntp-capture-timestamp", path: "/test/ntp-capture-timestamp", category: "Debug" }`.

- [x] **Step 1: Write the failing tests**

```ts
expect(unixEpochUsToNtpTimestamp(1779794971275150)).toBe(
  "17131695848442313467",
);
expect(
  findNearestNtpTimestamp(
    ["17131695848442313467", "17131695848446608434"],
    "17131695848442313467",
    20,
  ),
).toEqual({ index: 0, diffMs: 0, matched: true });
expect(parseNtpTimestampList("frame: 17131695848442313467\nignored")).toEqual([
  "17131695848442313467",
]);
```

Add a catalog expectation for the ID, route, and `Debug` category.

- [x] **Step 2: Verify the test fails**

Run: `npm test -- lib/ntp-timestamp.test.ts config/testPages.test.ts`

Expected: FAIL because the NTP module and catalog entry do not exist.

- [x] **Step 3: Implement the utility and catalog entry**

Use `BigInt` constants for the NTP epoch offset and fraction scale. Reject invalid Unix microseconds with `RangeError`; parse decimal values from each input line; select the smallest absolute NTP delta and round it to milliseconds.

- [x] **Step 4: Verify the focused tests pass**

Run: `npm test -- lib/ntp-timestamp.test.ts config/testPages.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/ntp-timestamp.ts lib/ntp-timestamp.test.ts config/testPages.ts config/testPages.test.ts
git commit -m "feat: add NTP timestamp utility"
```

### Task 2: Native NTP capture timestamp page

**Files:**
- Create: `app/test/ntp-capture-timestamp/page.tsx`
- Create: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: the four `lib/ntp-timestamp.ts` exports.
- Consumes: `navigator.mediaDevices.getUserMedia` and optional `MediaStreamTrackProcessor` / `requestVideoFrameCallback`.
- Produces: capture controls, timestamp comparison, a scrollable result table, diagnostics, and CSV export.

- [x] **Step 1: Write the failing page rendering test**

```ts
import { renderToStaticMarkup } from "react-dom/server";
import NtpCaptureTimestampPage from "./page";

it("renders NTP capture controls and estimate safety guidance", () => {
  expect(
    renderToStaticMarkup(<NtpCaptureTimestampPage />),
  ).toContain("NTP Capture Timestamp");
  expect(renderToStaticMarkup(<NtpCaptureTimestampPage />)).toContain(
    "Start capture",
  );
  expect(renderToStaticMarkup(<NtpCaptureTimestampPage />)).toContain(
    "estimate",
  );
});
```

- [x] **Step 2: Verify the test fails**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because the page module does not exist.

- [x] **Step 3: Implement the client page**

Create a `"use client"` page. Store the stream and frame reader in refs, stop them on user stop and unmount, and retain at most 200 rows. Prefer native `VideoFrame.timestamp`; otherwise use frame-callback or 10 fps timer samples, marked as estimates. Render API badges, camera preview, concise action buttons, server timestamp text area, tolerance control, nearest-match table, Copy CSV feedback, and a capped diagnostics log. Use responsive Tailwind classes aligned with existing test pages.

- [x] **Step 4: Verify page rendering and production compilation**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts && npm run build`

Expected: page rendering test PASS and build exit 0.

- [ ] **Step 5: Manually validate browser behavior**

Run: `npm run dev`

At `/test/ntp-capture-timestamp`, check camera permission flow, native/fallback source label, server matching, and visible CSV success/failure feedback.

- [ ] **Step 6: Run full verification and commit**

```bash
npm test
npm run build
git add app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts
git commit -m "feat: add NTP capture timestamp test page"
```
