"use client";

import dynamic from "next/dynamic";

const SeiPrototypeApp = dynamic(
  () => import("@/features/sei-prototype/SeiPrototypeApp"),
  { ssr: false }
);

export default function SeiPrototypePage() {
  return (
    <div className="min-h-[88vh] overflow-hidden rounded-2xl border border-[#ede9f8] dark:border-white/[0.06] bg-white dark:bg-[#0e0e12]">
      <SeiPrototypeApp />
    </div>
  );
}
