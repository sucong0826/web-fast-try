"use client";

import dynamic from "next/dynamic";

const EmbeddedWebRtcMeetingApp = dynamic(
  () => import("@/features/webrtc-meeting/EmbeddedApp"),
  { ssr: false }
);

export default function WebRtcMeetingPage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <EmbeddedWebRtcMeetingApp />
    </div>
  );
}
