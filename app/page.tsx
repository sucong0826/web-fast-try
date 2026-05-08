import Link from "next/link";
import { testPages } from "@/config/testPages";
import {
  Video,
  Mic,
  Wifi,
  Info,
  Monitor,
  Camera,
  TestTube,
  Bug,
  Cpu,
  Zap,
  Users,
} from "lucide-react";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Video,
  Mic,
  Wifi,
  Info,
  Monitor,
  Camera,
  TestTube,
  Bug,
  Cpu,
  Zap,
  Users,
};

const categoryStyle: Record<string, { icon: string; badge: string }> = {
  Media:   { icon: "from-violet-500 to-purple-600",  badge: "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
  Network: { icon: "from-emerald-400 to-teal-500",   badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  System:  { icon: "from-sky-400 to-blue-500",       badge: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" },
  Debug:   { icon: "from-amber-400 to-orange-500",   badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  "ML/AI": { icon: "from-rose-400 to-pink-600",      badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" },
};

const fallback = { icon: "from-slate-400 to-slate-500", badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

export default function Home() {
  return (
    <div className="min-h-screen bg-[#faf9ff] dark:bg-[#0e0e12]">
      <div className="container mx-auto px-4 py-14">

        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20 mb-5">
            <TestTube className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f0e1a] dark:text-[#f1f0f6] mb-3">
            WebFastTry
          </h1>
          <p className="text-sm text-[#6e6a85] dark:text-[#65627a] max-w-xs mx-auto">
            Internal testing platform — select a module to begin
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-w-7xl mx-auto">
          {testPages.map((page) => {
            const Icon = iconMap[page.icon] ?? TestTube;
            const style = categoryStyle[page.category ?? ""] ?? fallback;
            return (
              <Link
                key={page.id}
                href={page.path}
                className="group flex flex-col items-center text-center p-7 rounded-2xl bg-white dark:bg-[#18181e] border border-[#ede9f8] dark:border-white/[0.06] shadow-sm hover:shadow-lg hover:shadow-violet-500/5 hover:-translate-y-1 transition-all duration-200"
              >
                <div
                  className={`w-13 h-13 bg-gradient-to-br ${style.icon} rounded-2xl flex items-center justify-center mb-4 shadow-sm group-hover:scale-105 transition-transform duration-200`}
                  style={{ width: 52, height: 52 }}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-[15px] font-semibold text-[#0f0e1a] dark:text-[#f1f0f6] mb-1">
                  {page.title}
                </h2>
                <p className="text-xs text-[#6e6a85] dark:text-[#65627a] mb-3 leading-relaxed">
                  {page.description}
                </p>
                {page.category && (
                  <span className={`inline-block px-2.5 py-0.5 text-[11px] font-medium rounded-full ${style.badge}`}>
                    {page.category}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <p className="text-center mt-14 text-xs text-[#6e6a85]/50 dark:text-[#65627a]/60">
          For internal use only · Click any card to start testing
        </p>
      </div>
    </div>
  );
}
