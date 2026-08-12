# Simplified VideoFrame-to-NTP Validation Page Design

## Goal

Replace the current multi-strategy `/test/ntp-capture-timestamp` laboratory with a focused page that validates one two-step conversion policy:

1. Prefer `VideoFrame.metadata().captureTime` when it is available and finite.
2. Otherwise approximate the frame time with `performance.timeOrigin + VideoFrame.timestamp / 1000`.

The page is an experiment and diagnostic tool. It must clearly distinguish a capture-time result from the timestamp fallback and must not imply that the fallback is accurate.

## Timestamp Formulas

All calculations use milliseconds until the final display. The fixed NTP-to-Unix epoch offset is `2_208_988_800_000` milliseconds.

When `captureTime` is available:

```text
unixTimestampMs = performance.timeOrigin + captureTime
ntpTimestampMs  = unixTimestampMs + 2_208_988_800_000
```

`captureTime` is a `DOMHighResTimeStamp` relative to `performance.timeOrigin`.

When `captureTime` is unavailable:

```text
unixTimestampMs = performance.timeOrigin + VideoFrame.timestamp / 1000
ntpTimestampMs  = unixTimestampMs + 2_208_988_800_000
```

`VideoFrame.timestamp` is expressed in microseconds, hence the division by `1000`. This mapping is an experimental approximation because a browser may expose a media or monotonic timestamp whose origin does not match `performance.timeOrigin`.

## Page Scope

Keep:

- The existing route `/test/ntp-capture-timestamp` and test-page catalog entry.
- Camera preview.
- Start, stop, and copy-result controls.
- `MediaStreamTrackProcessor` as the source of native `VideoFrame` objects.
- Explicit camera and API availability feedback.
- Camera cleanup on stop and component unmount.

Remove:

- Naive Unix, client-anchor, and manual server-anchor strategies.
- Server timestamp inputs, tolerance controls, and nearest-value matching.
- Reference-frame controls.
- Multi-strategy cards.
- Frame history comparison table and CSV export.
- Anchor creation and all anchor-related language.

## Frame Processing

For each native frame:

1. Read `frame.timestamp`.
2. Call `frame.metadata()` when the method exists.
3. Treat `metadata.captureTime` as available only when it is a finite, non-negative number.
4. Select the capture-time formula when available; otherwise select the timestamp fallback formula.
5. Preserve enough precision for the displayed millisecond value and copy it as a decimal string.
6. Update the page with the latest frame only.
7. Close the frame in a `finally` block.

If `metadata()` is absent or throws, record that diagnostic state and use the timestamp fallback. An exception from one frame must not stop capture.

## Display

The page displays only the latest calculation:

- Raw `VideoFrame.timestamp` in microseconds.
- `performance.timeOrigin` in milliseconds.
- The complete serializable `VideoFrame.metadata()` result.
- `captureTime`, or `Unavailable`.
- The selected method: `metadata.captureTime` or `timeOrigin + VideoFrame.timestamp`.
- Calculated Unix epoch milliseconds as a diagnostic intermediate.
- Calculated NTP epoch milliseconds, visually emphasized.
- UTC interpretation of the calculated Unix time.

The capture-time branch uses a success treatment. The fallback branch uses a persistent yellow warning stating that it is an unverified approximation. The fallback result remains visible and copyable even when its clock origin appears implausible.

The copy action copies the NTP epoch-millisecond decimal value only, matching the server representation used in the existing investigation. Standard NTP Q32.32 conversion is out of scope for this simplified page.

## Manual Formula Calculator

Section `2. Calculate` contains a manual NTP timestamp calculator in addition to the latest live-frame result. It lets an engineer reproduce the agreed formulas without starting the camera.

The calculator has two explicitly selected modes:

1. **`captureTime` mode**
   - Inputs: `performance.timeOrigin` in milliseconds and `captureTime` in milliseconds.
   - Formula: `NTP ms = timeOrigin + captureTime + 2_208_988_800_000`.
   - This is labeled as the preferred calculation when capture metadata is available.
2. **`VideoFrame.timestamp` mode**
   - Inputs: `performance.timeOrigin` in milliseconds and `VideoFrame.timestamp` in microseconds.
   - Formula: `NTP ms ≈ timeOrigin + VideoFrame.timestamp / 1000 + 2_208_988_800_000`.
   - This always displays the unverified-approximation warning.

Only the timestamp input relevant to the selected mode is visible. Switching modes clears the previous calculated result so a result cannot be mistaken for the newly selected formula. Input text is retained per mode for convenient comparison.

The user explicitly starts evaluation with a `Calculate NTP timestamp` button. Valid input produces:

- Unix epoch milliseconds before adding the NTP offset.
- NTP epoch milliseconds as the primary result.
- UTC interpretation of the Unix value.
- A substituted calculation expression showing the supplied values, unit conversion, and epoch offset.
- A copy button that copies only the NTP epoch-millisecond decimal value.

Inputs accept finite, non-negative decimal values. Blank, negative, non-numeric, and non-finite values display an inline validation error and do not retain a stale result. Calculations preserve decimal millisecond precision supported by JavaScript numbers; the page does not round the primary result to a whole millisecond.

The manual calculator is independent of live capture. Starting or stopping the camera does not overwrite its inputs or result, and manually entered values do not alter the latest captured-frame calculation.

## API Fallbacks

If `MediaStreamTrackProcessor` is unavailable, the page reports that native `VideoFrame.timestamp` and `VideoFrame.metadata()` cannot be tested. It does not fabricate a `VideoFrame` value through `requestVideoFrameCallback` or a wall-clock timer because those paths cannot validate the agreed conversion policy.

## Error Handling

- Camera permission and secure-context errors are shown inline.
- Missing `MediaStreamTrackProcessor` is shown as an unsupported-browser state.
- Invalid or non-finite timestamps do not produce an NTP result.
- `metadata()` failures are displayed while capture continues through the documented timestamp fallback.
- Start/stop operations remain idempotent and release the reader, stream tracks, and preview object.

## Testing and Verification

Pure conversion helpers will be covered for:

- `captureTime` preferred over `VideoFrame.timestamp`.
- Missing, invalid, and throwing metadata falling back to `VideoFrame.timestamp`.
- Correct microsecond-to-millisecond conversion.
- Correct addition of the NTP/Unix epoch offset.
- Method and confidence labels.
- Both manual calculator modes and their unit conversions.
- Decimal inputs and invalid manual calculator inputs.

The page test will verify the simplified capture controls, calculator mode selector, manual inputs, formulas, output labels, fallback warning, and removal of anchor/server-comparison UI. Before deployment, run the focused tests, full test suite, and production build. Then push `main` so the connected Vercel project deploys the commit and verify the production route.
