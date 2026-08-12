"use client";

import { useState, type ReactNode } from "react";

export function Tabs({
  tabs,
  initialKey,
}: {
  tabs: { key: string; label: string; content: ReactNode }[];
  // Lets a server action's redirect land back on the tab it mutated
  // (e.g. "?tab=users") instead of always resetting to the first tab —
  // falls back to the first tab when absent or stale (a key from a tab
  // that no longer exists).
  initialKey?: string;
}) {
  const [active, setActive] = useState(
    initialKey && tabs.some((tab) => tab.key === initialKey) ? initialKey : tabs[0]?.key
  );
  const activeTab = tabs.find((tab) => tab.key === active) ?? tabs[0];

  return (
    <div className="mt-8">
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={
                tab.key === activeTab?.key
                  ? "border-b-2 border-gray-900 px-1 py-2 text-sm font-medium text-gray-900"
                  : "border-b-2 border-transparent px-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">{activeTab?.content}</div>
    </div>
  );
}
