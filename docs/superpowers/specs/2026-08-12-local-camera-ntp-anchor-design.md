# Local Camera VideoFrame NTP Anchor Design

## Goal

Calculate an NTP-epoch millisecond value for locally captured `VideoFrame` objects without assuming that `VideoFrame.timestamp` shares `performance.timeOrigin`'s zero point.

## Scope

- The page supports local-camera tracks created with `getUserMedia` and read with `MediaStreamTrackProcessor`.
- The page exposes a selectable strategy:
  - **Prefer `metadata.captureTime`**: use valid `captureTime`, then fall back to a local clock anchor.
  - **Use `VideoFrame.timestamp` anchor**: always use the local clock anchor, even when `captureTime` exists.
- The page keeps the Unix/NTP epoch converter.

## Non-goals

- Deriving a remote WebRTC sender's NTP clock.
- Treating a raw `VideoFrame.timestamp` as an absolute timestamp.
- Producing NTP's 64-bit Q32.32 wire representation; the result is decimal milliseconds since the 1900 NTP epoch.

## Time Model

`VideoFrame.timestamp` is a presentation timestamp in microseconds whose origin depends on the source. For a local camera it can be related to a platform monotonic clock (for example, system uptime), so this invalid formula must not be used:

```ts
performance.timeOrigin + frame.timestamp / 1000;
```

When `metadata.captureTime` is a finite non-negative number, it is relative to `performance.timeOrigin`. Its Unix-epoch millisecond value is:

```ts
unixMs = performance.timeOrigin + metadata.captureTime;
```

When capture time is unavailable or the selected policy explicitly chooses timestamp anchoring, sample the two clocks as soon as a frame is read:

```ts
frameTimestampMs = frame.timestamp / 1000;
wallProjectionMs = performance.timeOrigin + performance.now();
sampleOffsetMs = wallProjectionMs - frameTimestampMs;
```

Store only a bounded recent window of 64 offsets. The anchor is the window minimum, since scheduling and camera-pipeline delay make later observations larger. The estimated Unix and NTP values are:

```ts
anchorOffsetMs = min(recentSampleOffsetMs);
unixMs = frame.timestamp / 1000 + anchorOffsetMs;
ntpMs = unixMs + 2_208_988_800_000;
```

The page must reset the anchor when capture starts or stops, when the selected strategy changes, and when the frame timestamp goes backwards or jumps forward by more than five seconds compared with the preceding frame.

## UI Behavior

The live-capture controls include a strategy selector before starting the camera. The selected option is captured for the current run and shown in the result:

- A valid `captureTime` used under the preferred policy reports the method as `capture-time`.
- All timestamp-anchor results report the method as `timestamp-anchor`, show the sample count and the current frame's observed extra delay, and say that the value is a local wall-clock mapping.
- Under the preferred policy, an unavailable or invalid capture time visibly explains that timestamp anchoring was used.

The manual calculator has matching options. The capture-time formula accepts `timeOrigin` and `captureTime`. The timestamp-anchor formula accepts a `VideoFrame.timestamp` in microseconds and an observed `performance.timeOrigin + performance.now()` value in milliseconds; it computes the single-sample anchor formula. Its labels must state that the live capture uses a rolling 64-sample minimum.

## Accuracy and Limits

`performance.timeOrigin + performance.now()` deliberately avoids a `Date.now()` jump during a session. It is a local wall-clock projection established on navigation, not a server-certified NTP source. The server and client may still differ by their clock offset. A real cross-machine NTP mapping requires a server/RTCP or other synchronized-clock anchor outside this page's local-camera scope.

## Verification

- Unit-test selection behavior, capture-time conversion, one-sample timestamp anchoring, rolling minimum selection, and anchor reset/discontinuity detection.
- Retain epoch-converter regression tests.
- Run the targeted Vitest suite, all tests, lint, and production build.
- Manually verify that both strategy choices are selectable and that their displayed formulas match the selected path.
