import { type FC, useEffect } from "react";
import TerminalView from "./Terminal";
import SessionPanel from "./SessionPanel";
import { useSessionStore } from "../stores/sessionStore";

interface SessionViewProps {
  projectId: string;
  projectName: string;
  projectPath?: string;
}

const SessionView: FC<SessionViewProps> = ({
  projectId,
  projectName,
  projectPath = "",
}) => {
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);

  // Load existing sessions from backend when entering a project
  useEffect(() => {
    setActiveProject(projectId);
    loadSessions(projectId);
  }, [projectId, loadSessions, setActiveProject]);

  return (
    <div className="flex h-screen bg-bg">
      <TerminalView />
      <SessionPanel
        projectId={projectId}
        projectName={projectName}
        projectPath={projectPath}
      />
    </div>
  );
};

export default SessionView;
