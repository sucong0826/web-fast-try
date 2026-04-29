# WebRTC Meeting Design

## Purpose

Build a pure WebRTC two-person meeting prototype inside WebFastTry. The feature is intended to be a realistic foundation for future meeting experiments, not a one-off demo. Phase 1 delivers the complete meeting app and signaling architecture. Phase 2 will add media processors after the core meeting lifecycle is stable.

## Explicit Boundaries

This feature does not reuse `features/videosdkcompare`, its Redux store, SDK manager, SDK adapters, or UI components. The new app only follows WebFastTry's existing test-page entry pattern:

- Add a home-page test card through `config/testPages.ts`.
- Add a route at `app/test/webrtc-meeting/page.tsx`.
- Load a self-contained feature module from `features/webrtc-meeting`.

The signaling layer is a separate Node WebSocket server stored in this repo, designed so it can run locally first and later move to an independent deployment.

## Phasing

### Phase 1: WebRTC Meeting Core

Phase 1 includes:

- Two-person create/join/leave room flow.
- Independent WebSocket signaling server.
- WebRTC offer, answer, trickle ICE, and renegotiation.
- Configurable STUN/TURN with a default public STUN server.
- Camera and microphone capture.
- Device selection and switching.
- Mute, camera on/off, and hang up.
- Screen sharing as a distinct video track.
- Chat.
- Signaling log, connection log, and basic WebRTC stats.
- Recording entry placeholder only.

Phase 1 excludes:

- Media processor implementation.
- Processor UI controls.
- Real recording.
- SFU/media server behavior.
- Authentication or account-based authorization.

### Phase 2: Media Processor

Phase 2 adds media routing and processors:

- Camera, microphone, and screen-share processors can be enabled independently.
- Processor off means raw track is sent.
- Processor on means processed track is sent.
- Processor failure must not break the meeting; routing falls back to raw media.
- The processor layer is inserted between local media capture and peer sender track selection.

Phase 1 should keep the peer engine API compatible with this future insertion, but it should not implement processor classes yet.

## Architecture

The feature uses a feature-module architecture with focused engines.

### `features/webrtc-meeting/EmbeddedApp`

Owns the React app shell for the meeting feature. It wires the store/provider, routing between join and meeting views, and high-level error boundaries.

### `MeetingController`

Coordinates the meeting lifecycle:

- Join room.
- Leave room.
- Start and stop local media.
- Create and close peer connections.
- Start and stop signaling.
- Start and stop stats collection.
- Surface errors and user-facing state.

The controller is the main bridge between UI actions and lower-level engines.

### `SignalingClient`

Wraps the browser WebSocket connection. It handles:

- Connecting to `NEXT_PUBLIC_SIGNALING_URL`.
- Sending and receiving typed signaling messages.
- Reconnect/error state.
- Room join/leave.
- Offer, answer, ICE, renegotiation, media-state, chat, and log events.

It does not know about DOM media elements or browser capture APIs.

### `PeerConnectionEngine`

Wraps `RTCPeerConnection`. It handles:

- Creating peer connections with configured ICE servers.
- Stable transceivers for microphone, camera, and screen share.
- Offer/answer exchange.
- Trickle ICE.
- Perfect negotiation handling.
- Track events.
- Sender track replacement.
- ICE restart.
- Connection cleanup.

It receives the current sender tracks from the controller and does not know whether a future track is raw or processed.

### `LocalMediaController`

Owns browser capture:

- `navigator.mediaDevices.getUserMedia`.
- `navigator.mediaDevices.getDisplayMedia`.
- Device enumeration.
- Device switching.
- Track stop/cleanup.
- Permission and unsupported-browser errors.

Phase 1 sends raw capture tracks. Phase 2 can place media routing and processing after this controller.

### `MeetingStore`

Uses React reducer/context instead of Redux. State is local to this feature and includes:

- Meeting lifecycle state.
- Local media state.
- Remote media state.
- WebSocket state.
- Peer connection state.
- ICE state.
- Chat messages.
- Signaling and connection logs.
- Stats snapshots.

### `StatsCollector`

Polls `RTCPeerConnection.getStats()` while connected. It normalizes useful values for the UI:

- Send and receive bitrate.
- Packet loss.
- RTT.
- Frame rate.
- Resolution.
- Candidate pair type and addresses when available.
- ICE and DTLS state.

### `EventLogger`

Records structured feature events:

- Signaling in/out.
- Offer/answer creation and receipt.
- ICE candidate send/receive.
- Renegotiation start/end.
- Track add/remove.
- Permission failures.
- WebSocket disconnects.
- Peer connection state changes.

The UI can clear and copy logs. The implementation should avoid noisy console logging except for unexpected errors.

### `SignalingServer`

A Node WebSocket server stored in the repo. It is independent from Next.js runtime and can be run locally beside `next dev`.

Responsibilities:

- Accept WebSocket connections.
- Validate message shape.
- Maintain in-memory rooms.
- Enforce two participants per room.
- Assign deterministic participant roles.
- Route messages between room participants.
- Broadcast join/leave state.
- Expire empty rooms.

The server does not relay media and does not inspect SDP contents beyond validating that message fields exist.

## Runtime And Configuration

Local development should support running both the Next.js app and signaling server from npm scripts. The implementation should be compatible with later independent deployment.

Configuration:

- `NEXT_PUBLIC_SIGNALING_URL`: WebSocket URL used by the browser client.
- `WEBRTC_SIGNALING_PORT`: local signaling server port.
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`: optional JSON or compact string configuration for STUN/TURN servers.

Default ICE configuration includes public STUN:

```json
[
  { "urls": "stun:stun.l.google.com:19302" }
]
```

The join screen should expose a compact advanced ICE panel so testers can provide TURN configuration without rebuilding.

## Signaling Protocol

All messages are JSON with a `type`, `roomId`, `participantId`, `requestId` or `messageId`, and `sentAt` when applicable.

Core message types:

- `join-room`
- `room-snapshot`
- `peer-joined`
- `peer-left`
- `room-full`
- `offer`
- `answer`
- `ice-candidate`
- `renegotiate-needed`
- `media-state`
- `chat-message`
- `stats-ping`
- `error`
- `leave-room`

Room rules:

- A room accepts at most two participants.
- The first participant is the offer initiator by default.
- The second participant is the answerer by default.
- If both clients trigger negotiation, the implementation uses the perfect negotiation pattern. The first participant is impolite and the second participant is polite.
- When a peer leaves, the remaining peer returns to a waiting state and can accept a new second participant.

Server-side validation:

- Unknown message types are rejected with `error`.
- Messages for unknown rooms are rejected except `join-room`.
- Messages from non-members are rejected.
- A third participant receives `room-full`.

## Meeting Lifecycle

1. User opens `/test/webrtc-meeting`.
2. User enters display name and room ID, or creates a random room.
3. Browser connects to `NEXT_PUBLIC_SIGNALING_URL`.
4. Client sends `join-room`.
5. Server returns `room-snapshot`.
6. If there is no peer, UI shows waiting state.
7. When a peer is present, both clients prepare local media and peer connection.
8. Offer initiator creates and sends offer.
9. Answerer applies offer, creates answer, and sends answer.
10. Both sides exchange trickle ICE candidates.
11. UI transitions to connected when peer connection reaches connected/completed state.
12. Control events continue through signaling and local WebRTC APIs.
13. Leave closes media tracks, peer connection, stats polling, room membership, and WebSocket as appropriate.

## Media And Track Strategy

Phase 1 uses raw browser capture tracks.

### Local Capture

- Camera and microphone use `getUserMedia`.
- Screen share uses `getDisplayMedia({ video: true, audio: false })`.
- Screen audio is excluded in Phase 1 to avoid inconsistent cross-browser behavior.
- The app allows joining without camera, without microphone, or with permissions denied.
- Device lists refresh after permission is granted and on `devicechange` when supported.

### Sender Tracks

Use Unified Plan with stable transceivers:

- Audio transceiver for microphone.
- Video transceiver for camera.
- Video transceiver for screen share.

Track behavior:

- Audio mute uses `track.enabled = false` for fast local mute/unmute.
- Camera off uses `track.enabled = false` when a camera track exists. Device switch or leave stops old camera tracks.
- The screen-share transceiver is created during initial peer setup so later share start/stop can use `replaceTrack()` without requiring a new m-line.
- Screen share start calls `replaceTrack(screenTrack)` on the pre-created screen sender.
- Screen share stop calls `replaceTrack(null)` and updates media state.
- Screen track `ended` from browser UI must stop share state and notify the peer.

### Negotiation

- The peer engine centralizes negotiation.
- Renegotiation requests are queued.
- Offer collision uses the perfect negotiation pattern.
- `replaceTrack` is preferred for device and media-state changes when renegotiation is not required.

### Remote Media

The UI maintains:

- Remote audio stream.
- Remote camera stream.
- Remote screen-share stream.

Remote media identity is derived from stable transceivers and synchronized `media-state`. Track events are used as a fallback, while `media-state` drives user-facing mute/camera/share indicators.

## Chat

Chat is included in Phase 1. User chat messages use RTCDataChannel after peer connection setup because it validates the P2P data path. The offer initiator creates the data channel before the initial offer, and the answerer handles the `datachannel` event. Signaling is used only for system messages before the data channel opens, not as the normal chat transport.

Chat state includes:

- Message ID.
- Sender participant ID.
- Sender display name.
- Body.
- Timestamp.
- Delivery state.

## Recording Placeholder

The UI includes a recording button or menu item, but Phase 1 does not record. When clicked, the app shows a clear message that recording is reserved for a later phase. The placeholder exists so the layout and state model reserve space for future recording work.

## UI Design

The page should feel simple, spacious, and practical. It should be a meeting workspace, not a landing page.

Visual direction:

- Large media stage.
- Neutral dark stage background.
- Light or subtle side panels.
- Minimal accent colors.
- Status colors limited to green, red, and yellow.
- Icon-first controls.
- No decorative gradients or marketing-style sections.

Main surfaces:

- Join screen with display name, room ID, create/join actions, signaling status, and advanced ICE configuration.
- Meeting top bar with room ID, copy link, peer status, WebSocket state, peer connection state, and ICE state.
- Main media stage.
- Side panel with Chat, Stats, and Logs tabs.
- Bottom control bar for mic, camera, share, devices, diagnostics, record placeholder, and leave.

Screen-share layout:

- Shared screen is the primary stage.
- Camera tiles move to a side strip.
- Camera tiles must not overlap shared content.

Responsive behavior:

- Desktop: stage plus side panel.
- Narrow screens: stage on top, controls sticky at bottom, side panel collapses into bottom drawer or tabs.
- Controls must retain stable dimensions and avoid text overflow.

## Error Handling

Expected errors should be recoverable where possible:

- Permission denied: show a clear message and allow joining without that device.
- No camera or microphone: disable only the affected control.
- `getDisplayMedia` unsupported: disable share with explanation.
- User cancels screen picker: show non-fatal share cancellation.
- WebSocket disconnect: show reconnecting/disconnected state.
- Room full: show a clear room-full state and let user choose another room.
- ICE failed: show failed state and offer ICE restart.
- Peer leaves: keep the local user in the room and return to waiting state.

Cleanup rules:

- Stop all local tracks on leave.
- Close peer connection on leave and peer reset.
- Close data channel on leave.
- Remove media element streams on unmount.
- Stop stats polling on disconnect/leave.
- Remove WebSocket listeners on cleanup.

## Testing And Verification

Automated tests should cover pure logic first:

- Signaling message schema validation.
- Room state and capacity behavior.
- Meeting reducer state transitions.
- Stats normalization from mocked `getStats()` reports.
- Event logger append, clear, and copy formatting.
- Peer engine negotiation decision logic with fakes.

Manual smoke tests are required for browser behavior:

- Create a room in one browser tab and join from a second tab.
- Join with camera and microphone.
- Join with camera denied.
- Join with microphone denied.
- Toggle mute.
- Toggle camera.
- Switch camera or microphone device when multiple devices exist.
- Start and stop screen share from app controls.
- Stop screen share from browser's native sharing indicator.
- Send and receive chat messages.
- Copy room link and join from it.
- Verify room-full behavior with a third tab.
- Leave from caller side.
- Leave from answerer side.
- Restart signaling server and verify UI disconnect state.
- Configure custom ICE servers from the join screen.

Build verification:

- `npm run build`
- Start Next.js and signaling server locally.
- Run a two-tab manual smoke test.

## Future Extension Notes

Phase 2 media processing should insert a `MediaRouteManager` between local capture and peer sender tracks:

```text
source track -> MediaRouteManager -> selected output track -> RTCPeerConnection sender
```

Processor behavior:

- Processor off sends raw track.
- Processor on sends processed track.
- Processor failure falls back to raw track.
- Processor state is independent for microphone, camera, and screen share.

This phase should use cross-browser primitives first:

- Video: hidden video element plus canvas rendering plus `canvas.captureStream()`.
- Audio: `AudioContext`, `AudioWorklet` or standard audio nodes, and `MediaStreamDestination`.
- Chromium-only `MediaStreamTrackProcessor`/generator APIs may be optional adapters, not the default foundation.

Future recording should avoid changing Phase 1 meeting lifecycle. It can consume local/remote render streams or a composed stream depending on the chosen recording requirement.
