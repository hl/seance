import { type FC } from "react";
import TerminalView from "./Terminal";
import SessionPanel from "./SessionPanel";

interface SessionViewProps {
  projectId: string;
  projectName: string;
  onBack: () => void;
}

const SessionView: FC<SessionViewProps> = ({
  projectId,
  projectName,
  onBack,
}) => {
  return (
    <div className="flex h-screen flex-col bg-neutral-950">
      {/* Header bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          title="Back to projects"
        >
          ←
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100">
          {projectName}
        </h1>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          title="Project settings"
        >
          ⚙
        </button>
      </header>

      {/* Main content: Terminal + Session Panel */}
      <div className="flex min-h-0 flex-1">
        <TerminalView />
        <SessionPanel projectId={projectId} />
      </div>
    </div>
  );
};

export default SessionView;
