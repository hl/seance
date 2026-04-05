import { type FC, useState, useEffect } from "react";
import TerminalView from "./Terminal";
import SessionPanel from "./SessionPanel";
import ProjectSettings from "./ProjectSettings";
import { useSessionStore } from "../stores/sessionStore";

interface SessionViewProps {
  projectId: string;
  projectName: string;
  projectPath?: string;
  onBack: () => void;
}

const SessionView: FC<SessionViewProps> = ({
  projectId,
  projectName,
  projectPath = "",
  onBack,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);

  // Load existing sessions from backend when entering a project
  useEffect(() => {
    setActiveProject(projectId);
    loadSessions(projectId);
  }, [projectId, loadSessions, setActiveProject]);

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
          onClick={() => setShowSettings(true)}
          className="rounded px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          title="Project settings"
        >
          ⚙
        </button>
      </header>

      {showSettings && (
        <ProjectSettings
          projectId={projectId}
          projectName={projectName}
          projectPath={projectPath}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Main content: Terminal + Session Panel */}
      <div className="flex min-h-0 flex-1">
        <TerminalView />
        <SessionPanel projectId={projectId} />
      </div>
    </div>
  );
};

export default SessionView;
