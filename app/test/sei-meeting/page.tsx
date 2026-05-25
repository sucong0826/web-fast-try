"use client";

import dynamic from "next/dynamic";

const SeiMeetingApp = dynamic(
  () => import("@/features/sei-prototype/networked/SeiMeetingApp"),
  { ssr: false }
);

export default function SeiMeetingPage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-2xl border border-[#ede9f8] dark:border-white/[0.06] bg-white dark:bg-[#0e0e12]">
      <SeiMeetingApp />
    </div>
  );
}
