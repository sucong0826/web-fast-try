# NTP Test Page Information Hierarchy Design

## Goal

Make the local-camera NTP test page easier to read by prioritizing the latest-frame result, presenting both UTC and browser-local time, moving all calculators to the end, and hiding low-level diagnostics until requested.

## Scope

- The timestamp values remain decimal Unix/NTP epoch milliseconds and retain their existing calculation behavior.
- A UTC timestamp remains visible for every calculated result.
- A browser-local interpretation is shown alongside UTC using the browser's current time zone.
- The layout order becomes Capture, Latest native frame, then Calculate.
- Low-level source and anchor diagnostics are collapsed by default.

## Time Presentation

Unix and NTP timestamps are epoch counts and do not have an intrinsic time zone. The page derives both human-readable interpretations from the Unix-epoch millisecond result:

```ts
utc = new Date(unixTimestampMs).toISOString();
local = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  timeZoneName: "short",
}).format(new Date(unixTimestampMs));
timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
```

The local-time label includes the resolved IANA zone where the browser provides one, for example `Browser local time (Asia/Shanghai)`. No fixed time zone or manual time-zone selector is added.

## Layout and Disclosure

### 1. Capture

Keep camera preview, capture status, start/stop controls, and the two timestamp-strategy choices at the top of the page.

### 2. Latest native frame

Move this section directly after Capture. When a frame is available, its primary result card shows, in this order:

1. NTP epoch milliseconds and copy action.
2. Unix epoch milliseconds.
3. UTC interpretation.
4. Browser-local interpretation with its IANA time-zone identifier.
5. Applied method (`metadata.captureTime` or local timestamp anchor).

The following items move into a closed native `<details>` element titled `Show diagnostics`:

- `VideoFrame.timestamp`, `performance.timeOrigin`, and observed wall projection.
- Capture-time availability, selected strategy, anchor sample count, offset, and extra delay.
- The substituted calculation expression.
- Complete `VideoFrame.metadata()` and any metadata error.

The empty state remains concise and prompts the user to start capture.

### 3. Calculate

Move the manual NTP calculator after Latest native frame. Its result displays the same UTC and browser-local interpretations. Keep the timestamp source inputs visible. Place the Unix/NTP epoch converter in a closed `<details>` element titled `Epoch converter`, retaining all inputs and copy behavior when opened.

## Accessibility and Testing

- Use semantic `details`/`summary` rather than a custom disclosure control.
- Preserve labels, copy buttons, and existing form behavior.
- Extend static page tests to assert the new section order, browser-local-time label, diagnostics disclosure, and collapsed epoch converter.
- Add pure formatting tests for a resolved browser time-zone label and millisecond precision without relying on a host-specific date string.

## Non-goals

- Changing NTP conversion, clock anchoring, or capture strategy semantics.
- Making the Unix timestamp itself time-zone-aware.
- Adding server-side or user-selectable time-zone conversion.
