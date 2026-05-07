"use client";

import { MeetingProvider } from "./store/MeetingProvider";
import { MeetingShell } from "./components/MeetingShell";

export default function EmbeddedWebRtcMeetingApp() {
  return (
    <MeetingProvider>
      <MeetingShell />
    </MeetingProvider>
  );
}
