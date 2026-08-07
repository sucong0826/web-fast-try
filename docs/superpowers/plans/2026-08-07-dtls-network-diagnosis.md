# DTLS Network Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the supplied DTLS diagnostic tool as a WebFastTry test page while retaining its browser-side diagnostic behavior.

**Architecture:** Serve the supplied single-file diagnostic runtime as a static asset so its WebRTC, TURN, report-export, and detailed diagnostic logic remain intact. Add an App Router route that presents it inside the existing test-page layout and add a home-card registry entry; update the diagnostic asset's visual CSS to match WebFastTry's light/dark card system.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Vitest, browser WebRTC APIs.

## Global Constraints

- Preserve all existing diagnostic checks, TURN configuration, time line, and report export behavior.
- The App Router path is `/test/dtls-network-diagnosis`.
- The supplied `scripts/dtls-network-diagnosis.html` must be removed after its static replacement is created.
- Do not add dependencies.
- Use WebFastTry's existing light/dark palette, rounded cards, responsive spacing, and navigation layout.

---

### Task 1: Register the DTLS test page

**Files:**
- Modify: `config/testPages.ts`
- Test: `config/testPages.test.ts`

**Interfaces:**
- Produces: a `TestPage` entry with id `dtls-network-diagnosis`, path `/test/dtls-network-diagnosis`, category `Network`, and a supported icon name.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { testPages } from "./testPages";

it("registers the DTLS network diagnosis route", () => {
  expect(testPages).toContainEqual(expect.objectContaining({
    id: "dtls-network-diagnosis",
    path: "/test/dtls-network-diagnosis",
    category: "Network",
  }));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- config/testPages.test.ts`

Expected: FAIL because no matching test-page entry exists.

- [x] **Step 3: Write minimal implementation**

```ts
{
  id: "dtls-network-diagnosis",
  title: "DTLS Network Diagnosis",
  description: "Diagnose WebRTC DTLS handshake and network conditions",
  icon: "ShieldCheck",
  path: "/test/dtls-network-diagnosis",
  category: "Network",
}
```

Add `ShieldCheck` to the existing icon map in `app/page.tsx`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- config/testPages.test.ts`

Expected: PASS.

### Task 2: Add the styled DTLS route and static diagnostic asset

**Files:**
- Create: `app/test/dtls-network-diagnosis/page.tsx`
- Create: `public/dtls-network-diagnosis.html`
- Delete: `scripts/dtls-network-diagnosis.html`

**Interfaces:**
- Consumes: the static diagnostic asset at `/dtls-network-diagnosis.html`.
- Produces: a responsive route page with an accessible title and full-height diagnostic frame.

- [x] **Step 1: Write the failing test**

Extend `config/testPages.test.ts` to assert the route registration; this test protects the user-facing entry point before adding the route.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- config/testPages.test.ts`

Expected: FAIL before Task 1 registers the route.

- [x] **Step 3: Write minimal implementation**

Create a client-free App Router page that uses the existing `/test` layout and renders a titled, responsive iframe pointing to `/dtls-network-diagnosis.html`. Move the supplied diagnostic document to `public/`, retain its script unchanged, and replace only its visual CSS with WebFastTry-aligned light/dark variables, elevated cards, consistent status badges, and responsive controls.

- [x] **Step 4: Run verification**

Run: `npm run build`

Expected: production build completes and resolves `/test/dtls-network-diagnosis`.

### Task 3: Verify diagnostic delivery

**Files:**
- Verify: `app/test/dtls-network-diagnosis/page.tsx`
- Verify: `public/dtls-network-diagnosis.html`

- [x] **Step 1: Run focused regression test**

Run: `npm test -- config/testPages.test.ts`

Expected: PASS.

- [x] **Step 2: Run complete test suite**

Run: `npm test`

Expected: PASS with zero failed tests.

- [x] **Step 3: Run production build**

Run: `npm run build`

Expected: exit code 0.
