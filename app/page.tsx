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
  Users
} from "lucide-react";

const iconMap: Record<string, React.ComponentType<any>> = {
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

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
            WebFastTry
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300">
            Internal Testing Platform - Select a test to begin
          </p>
        </div>

        {/* Test Pages Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {testPages.map((page) => {
            const Icon = iconMap[page.icon] || TestTube;
            return (
              <Link
                key={page.id}
                href={page.path}
                className="group bg-white dark:bg-gray-800 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 p-8 flex flex-col items-center text-center"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Icon className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  {page.title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {page.description}
                </p>
                {page.category && (
                  <span className="inline-block px-3 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
                    {page.category}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <div className="text-center mt-16 text-gray-500 dark:text-gray-400">
          <p className="text-sm">
            For internal use only • Click on any card to start testing
          </p>
        </div>
      </div>
    </div>
  );
}

