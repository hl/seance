import { type FC } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { SessionTab } from "../stores/sessionStore";

const TABS: { id: SessionTab; label: string; shortcut: string }[] = [
  { id: "terminal", label: "Terminal", shortcut: "1" },
  { id: "markdown", label: "Markdown", shortcut: "2" },
  { id: "diff", label: "Diff", shortcut: "3" },
];

const TabBar: FC = () => {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeTab = useSessionStore((s) =>
    s.activeSessionId ? s.getActiveTab(s.activeSessionId) : "terminal",
  );
  const setActiveTab = useSessionStore((s) => s.setActiveTab);

  if (!activeSessionId) return null;

  return (
    <div className="flex border-b border-border bg-bg-secondary shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(activeSessionId, tab.id)}
          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
            activeTab === tab.id
              ? "text-text border-b-2 border-accent bg-bg"
              : "text-text-muted hover:text-text hover:bg-bg-hover"
          }`}
        >
          {tab.label}
          <span className="ml-1.5 text-[10px] text-text-muted opacity-50">
            {"\u2318\u21E7"}{tab.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
};

export default TabBar;
