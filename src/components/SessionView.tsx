import { type FC, useEffect, lazy, Suspense } from "react";
import TerminalView from "./Terminal";
import SessionPanel from "./SessionPanel";
import TabBar from "./TabBar";
import { useSessionStore } from "../stores/sessionStore";

const MarkdownBrowser = lazy(() => import("./MarkdownBrowser"));
const DiffViewer = lazy(() => import("./DiffViewer"));

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
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeTab = useSessionStore((s) =>
    s.activeSessionId ? s.getActiveTab(s.activeSessionId) : "terminal",
  );

  // Load existing sessions from backend when entering a project
  useEffect(() => {
    setActiveProject(projectId);
    loadSessions(projectId);
  }, [projectId, loadSessions, setActiveProject]);

  return (
    <div className="flex h-screen bg-bg">
      <div className="flex flex-1 flex-col overflow-hidden">
        <TabBar />
        <div className="relative flex-1 overflow-hidden">
          {/* Terminal — always mounted via display:none/block to preserve xterm state */}
          <div
            className="absolute inset-0"
            style={{ display: activeTab === "terminal" ? "block" : "none" }}
          >
            <TerminalView />
          </div>

          {/* Markdown browser — always mounted to preserve scroll/selection state */}
          <div
            className="absolute inset-0 overflow-auto"
            style={{ display: activeTab === "markdown" ? "block" : "none" }}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-text-muted text-sm">
                  Loading...
                </div>
              }
            >
              {activeSessionId && (
                <MarkdownBrowser
                  sessionId={activeSessionId}
                  isActive={activeTab === "markdown"}
                />
              )}
            </Suspense>
          </div>

          {/* Diff viewer — always mounted to preserve scroll state */}
          <div
            className="absolute inset-0 overflow-auto"
            style={{ display: activeTab === "diff" ? "block" : "none" }}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-text-muted text-sm">
                  Loading...
                </div>
              }
            >
              {activeSessionId && (
                <DiffViewer
                  sessionId={activeSessionId}
                  isActive={activeTab === "diff"}
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>
      <SessionPanel
        projectId={projectId}
        projectName={projectName}
        projectPath={projectPath}
      />
    </div>
  );
};

export default SessionView;
