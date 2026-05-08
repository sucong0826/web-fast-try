"use client";

import dynamic from "next/dynamic";

const EmbeddedWebRtcMeetingApp = dynamic(
  () => import("@/features/webrtc-meeting/EmbeddedApp"),
  { ssr: false }
);

export default function WebRtcMeetingPage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-2xl border border-[#ede9f8] dark:border-white/[0.06] bg-white dark:bg-[#0e0e12]">
      <EmbeddedWebRtcMeetingApp />
    </div>
  );
}
