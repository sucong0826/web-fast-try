# Island Browser Test — web-fast-try integration design

_Generated: 2026-05-12_

## Goal

Integrate the standalone `test.html` (Zoom Web Media — Island Browser Capability Test) into the `web-fast-try` Next.js project as a new test page at `/test/island-browser`, restyled to match the project's existing UI conventions, while preserving the underlying detection / predicate / probe / report logic byte-for-byte.

Customers (Island Browser users) will open the page, click **Copy Report**, and paste the Markdown report back to engineering (clever.su@zoom.us) so the team can confirm which Zoom features will work on their build.

## Constraint: logic preservation

The UA parsing, predicate gates, WebCodecs probes, and report builders in `test.html` are carefully tuned to mirror the Zoom Web SDK's internal feature gates. Any semantic change to this logic invalidates the diagnostic.

**Rule:** the detection / probe / predicate / report code in the new page must be a verbatim copy of the corresponding code in `test.html`. TypeScript syntax additions are allowed (type annotations, `as const`, explicit interfaces) but the runtime behavior — regexes, comparison operators, branch order, output keys, output values, output formatting — must be identical.

## File layout

```
features/island-browser-test/
└── lib/
    ├── ua-detection.ts   # parseBrowserName, parseEngine, parseOS, helpers + uaResult build
    ├── api-probes.ts     # sync addApi() calls; async probeVideoDecoder / probeVideoEncoder
    ├── findings.ts       # H1–H7, M1–M6, R1–R3, W1 predicates
    ├── report.ts         # buildReport (Markdown), JSON payload, statusEmoji, escapeMd
    └── types.ts          # shared types (RawSignals, UaResult, ApiResult, Finding, Status)

app/test/island-browser/
└── page.tsx              # "use client" — orchestrates state + Tailwind rendering

config/testPages.ts       # add registry entry
```

## Module responsibilities

### `lib/types.ts`

```ts
export type Status = "pass" | "fail" | "warn" | "info" | "na";

export interface RawSignals { /* keys identical to raw object in test.html */ }
export interface UaResult { /* string keys identical to uaResult object */ }
export interface ApiResult { label: string; status: Status; detail: string; }
export interface Finding { id: string; feature: string; gate: string; status: Status; detail: string; }
```

### `lib/ua-detection.ts`

Exports:
- `collectRawSignals(): RawSignals` — reads `navigator`, `screen`, `window` and returns the same object literal built in test.html lines 343–367.
- `parseBrowserName(ua: string)` — verbatim from lines 389–420.
- `parseEngine(ua: string)` — verbatim from lines 422–442.
- `parseOS(plat: string, ua: string)` — verbatim from lines 444–454.
- Helper predicates (`isMac`, `isWindows`, `isChromeOS`, `isAndroid`, `isMobile`, `isChromeOrChromium`, `isChrome`, `isEdge`, `isFirefox`, `isSafari`, `isBlinkKernel`, `isWindowsChrome`, `isMacIntelSafariOrChrome`, `isChromeVersionHigherThan`, `versionGreaterOrEqualThan`) — verbatim from lines 461–510. Each takes `raw`, `ua`, `browser`, `engine` (or a closure containing them) so the React page can hold them as one detection context.
- `buildUaResult(ctx): UaResult` — verbatim from lines 512–536.

### `lib/api-probes.ts`

Exports:
- `runSyncApiChecks(raw: RawSignals): ApiResult[]` — verbatim from lines 542–640 (every `addApi(...)` call + the WebAssembly SIMD validate).
- `probeVideoDecoder(): Promise<{supported: boolean; config?: any; error?: string} | null>` — verbatim from lines 644–663 (including the exact extradata `Uint8Array`).
- `probeVideoEncoder(): Promise<...>` — verbatim from lines 664–681.

### `lib/findings.ts`

Exports:
- `buildSyncFindings(ctx, raw, ua, apiState): Finding[]` — verbatim H1, H2, H3, H4, H5, H6, H7, M1, M2, M3, M4, M5, M6, R1, R2, R3 from lines 690–971. All branch conditions and detail strings copied unchanged.
- `buildWebCodecsFinding(decRes, encRes): Finding` — verbatim W1 from lines 1100–1109.

### `lib/report.ts`

Exports:
- `buildReport(raw, uaResult, apiResults, findings): string` — verbatim from lines 1118–1157 (Markdown output, identical column structure and emoji set).
- `buildJsonPayload(raw, uaResult, apiResults, findings)` — same shape as the JSON download in lines 1196–1213.
- `statusEmoji`, `escapeMd` — verbatim from lines 1158–1165.

### `app/test/island-browser/page.tsx`

Client component (`"use client"`). On mount:
1. Calls `collectRawSignals()` → `parseBrowserName/Engine/OS` → `buildUaResult` → `runSyncApiChecks` → `buildSyncFindings` → stores all in component state.
2. Fires the async IIFE: `probeVideoDecoder()` + `probeVideoEncoder()` in parallel; on resolve, appends two `ApiResult` rows and one W1 `Finding` to state.
3. Renders four cards (Summary, Browser identification, Web API checks, Per-finding) using Tailwind classes consistent with the rest of `web-fast-try`.
4. Sticky bottom action row with **📋 Copy Report (Markdown)** and **⬇ Download JSON** — same behaviors as test.html lines 1174–1214 (including textarea fallback for copy).
5. Toast feedback on copy.

### Page styling

| Element | Tailwind |
|---|---|
| Page background | inherited from `app/test/layout.tsx` (`bg-gray-50 dark:bg-gray-900`) |
| Header block | violet/purple gradient matching `app/page.tsx` cards |
| Cards | `bg-white dark:bg-[#18181e] border border-[#ede9f8] dark:border-white/[0.06] rounded-2xl shadow-sm p-5 mb-4` |
| Pills | `text-xs font-semibold px-2 py-0.5 rounded-full` + status color (PASS green, FAIL red, WARN amber, INFO blue, N/A slate) |
| Table label col | `text-[#6e6a85] dark:text-[#65627a] text-xs uppercase tracking-wider` |
| Table value col | `font-mono text-[13px] break-all` |
| Buttons | primary: violet gradient like home page; secondary: outlined |
| Toast | fixed bottom-center, dark pill |

### Audit reference footer

**Removed** from the new page. The original `kb/island-browser-audit-2026-05-12.md` reference and "Test page version 2026-05-12" line do not appear in the integrated version.

### Registry entry

Added to `config/testPages.ts`:

```ts
{
  id: "island-browser",
  title: "Island Browser Test",
  description: "Zoom Web Media capability check for Island Browser",
  icon: "TestTube",
  path: "/test/island-browser",
  category: "Debug"
}
```

`TestTube` is already in `app/page.tsx` iconMap. `Debug` category is already styled.

## Out of scope

- Rewriting any predicate, regex, version compare, or WebCodecs config payload.
- Removing or "cleaning up" the existing parsing logic (matters because customer reports must remain comparable across versions).
- Adding new findings, telemetry, or auto-submit behavior.
- Removing the original `test.html` from the repo (left in place until the new page is verified by the engineering team).

## Verification

After implementation:
1. `npm run build` succeeds.
2. `/test/island-browser` renders without console errors in Chrome.
3. Side-by-side comparison: run `test.html` and `/test/island-browser` in the same browser, click **Download JSON** on each, diff the two JSON files — they should match (modulo `generatedAt` timestamp).
