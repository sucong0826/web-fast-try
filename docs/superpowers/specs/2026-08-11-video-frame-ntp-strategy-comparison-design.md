# VideoFrame-to-NTP Strategy Comparison Design

## Goal

Extend `/test/ntp-capture-timestamp` into a browser laboratory that captures real `VideoFrame.timestamp` values, calculates NTP timestamps through every relevant standard and non-standard strategy, and makes each strategy's assumptions and error against server values visible.

## Scope

- Keep the existing Next.js route, camera lifecycle, diagnostics, CSV export, and 200-row limit.
- Add strategy comparison to the existing page rather than create a duplicate route.
- Support both NTP epoch milliseconds such as `3995421530355` and standard unsigned Q32.32 decimal values such as `17131695848442313467`.
- Do not add runtime dependencies or contact an external time service.
- Treat any mapping without a server/RTCP clock correlation as an estimate, never as guaranteed capture time.

## Conversion Strategies

Every captured frame produces results for four strategies.

1. **Naive Unix-microseconds interpretation**
   - Formula: `unixMs = frameTimestampUs / 1000`.
   - Purpose: demonstrate the common epoch mistake and its implausible calendar result.
   - Confidence: invalid unless the timestamp source explicitly guarantees Unix-epoch microseconds.

2. **Performance time-origin interpretation**
   - Formula: `unixMs = performance.timeOrigin + frameTimestampUs / 1000`.
   - Also calculate `frameTimestampUs / 1000 - performance.now()` at observation time.
   - Confidence: experimental; mark it plausible only when the absolute diagnostic delta is at most 5,000 ms, otherwise mark it unverified. Display the threshold explicitly.

3. **First observed frame anchored to the client wall clock**
   - Capture `(firstFrameTimestampUs, Date.now())` once per run.
   - Formula: `unixMs = anchorUnixMs + (frameTimestampUs - anchorFrameTimestampUs) / 1000`.
   - Confidence: useful continuity estimate, but includes capture, queue, processing, and JavaScript observation latency.

4. **Manual server anchor**
   - User supplies one reference `VideoFrame.timestamp` and one corresponding server NTP value.
   - Formula: `targetNtpMs = referenceNtpMs + (targetFrameTimestampUs - referenceFrameTimestampUs) / 1000`.
   - Confidence: best available application-level mapping when the reference pair describes the same media timeline; surface an explicit warning otherwise.

## NTP Representations

The utility layer will represent absolute time internally as integer microseconds where possible and use `BigInt` for standard NTP arithmetic.

- **NTP epoch milliseconds:** `ntpEpochMs = unixEpochMs + 2208988800000`.
- **NTP Q32.32:** upper 32 bits are NTP seconds and lower 32 bits are the fractional second. Display the combined unsigned 64-bit value as a decimal string.
- Parsing and formatting must never silently confuse the two representations. The server-input control requires the user to select a format; do not auto-detect by magnitude.

## Page Structure

1. **Capture panel:** existing camera preview and start/stop controls, plus live `performance.timeOrigin`, `performance.now()`, `Date.now()`, raw frame timestamp, and the shared-origin diagnostic delta.
2. **Strategy panel:** four compact cards showing formula, current result, UTC interpretation where applicable, and confidence/warning status.
3. **Server comparison panel:** server-format selector, multiline server values, tolerance, and manual reference-pair inputs. Allow using a captured row as the reference frame.
4. **Results table:** one row per captured frame with raw timestamp, results from all four strategies, nearest server difference, selected strategy, and status. Keep the table horizontally scrollable.
5. **Diagnostics and export:** preserve the capped log and export enough fields to reproduce every calculation.

## Data Flow

`MediaStreamTrackProcessor` remains the preferred source. Each raw timestamp and its JavaScript observation clocks are captured together, passed to pure conversion functions, compared with normalized server timestamps, then appended to the bounded result list. Fallback sources remain visibly identified and must not masquerade as raw `VideoFrame.timestamp` values.

## Error Handling

- Reject malformed, negative, unsafe, or out-of-range timestamp input with an inline message.
- Disable manual-anchor results until both reference values are valid.
- Mark time-origin results as unverified when the frame/performance delta is not plausibly small.
- Preserve camera, unsupported API, stream termination, and clipboard diagnostics.
- Handle Q32.32 arithmetic and wrap-sensitive values with `BigInt`.

## Verification

- Unit-test NTP epoch-millisecond and Q32.32 conversions in both directions.
- Unit-test all four strategy formulas with the discussed sample values:
  - `VideoFrame.timestamp = 106574320365` microseconds.
  - Server NTP epoch milliseconds `3995421530355`.
- Verify that the manual-anchor strategy maps the reference sample exactly and advances later frames by their media-timestamp delta.
- Verify that the naive strategy exposes the 1973 result rather than labeling it correct.
- Render-test the new strategy and server-format controls.
- Run focused tests, the full Vitest suite, TypeScript/Next.js production build, and manual camera validation on localhost or HTTPS.

## Non-goals

- Claiming that a bare `VideoFrame.timestamp` uniquely determines wall-clock or server NTP time.
- Implementing an NTP network client in the browser.
- Exposing RTCP Sender Reports through APIs the browser does not provide.
- Hiding network, capture, decode, or JavaScript scheduling latency behind a false precision claim.
