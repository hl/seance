import { type FC, useState, useCallback, useMemo } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useSessionStore } from "../stores/sessionStore";
import { useProjectSessionEvents } from "../hooks/useSessionEvents";
import { useElapsedTime } from "../hooks/useElapsedTime";
import SessionCard from "./SessionCard";
import NewSessionInput from "./NewSessionInput";
import ProjectSettings from "./ProjectSettings";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

interface SessionPanelProps {
  projectId: string;
  projectName: string;
  projectPath: string;
}

const SessionPanel: FC<SessionPanelProps> = ({
  projectId,
  projectName,
  projectPath,
}) => {
  useProjectSessionEvents(projectId);
  const tick = useElapsedTime();

  const [showInput, setShowInput] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const killSession = useSessionStore((s) => s.killSession);
  const restartSession = useSessionStore((s) => s.restartSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  const projectSessions = useMemo(() => {
    return Array.from(sessions.values())
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [sessions, projectId]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
    },
    [],
  );

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const session = sessions.get(contextMenu.sessionId);
    if (!session) return [];

    const isAlive = session.status !== "exited" && session.status !== "done";
    const items: ContextMenuItem[] = [];

    items.push({
      label: "Rename",
      onClick: () => {
        setRenamingSessionId(contextMenu.sessionId);
        setContextMenu(null);
      },
    });

    if (isAlive) {
      items.push({
        label: "Kill",
        onClick: async () => {
          setContextMenu(null);
          const confirmed = await confirm(
            "Are you sure you want to kill this session?",
            { title: "Kill Session", kind: "warning" },
          );
          if (confirmed) {
            killSession(session.id);
          }
        },
      });
    }

    if (session.status === "exited") {
      items.push({
        label: "Restart",
        onClick: () => {
          setContextMenu(null);
          restartSession(session.id);
        },
      });
    }

    if (!isAlive) {
      items.push({
        label: "Delete",
        variant: "danger",
        onClick: () => {
          setContextMenu(null);
          deleteSession(session.id);
        },
      });
    }

    return items;
  }, [contextMenu, sessions, killSession, restartSession, deleteSession]);

  const handleNewSession = useCallback(() => {
    setShowInput(true);
  }, []);

  const handleInputDone = useCallback(() => {
    setShowInput(false);
  }, []);

  return (
    <div className="flex w-70 shrink-0 flex-col border-l border-border bg-bg">
      {/* Project name + settings */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {projectName}
        </h1>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="px-2 py-1 text-sm text-text-muted transition-colors hover:bg-interactive-hover hover:text-text-secondary-hover"
          title="Project settings"
        >
          ⚙
        </button>
      </div>

      {/* Sessions header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium text-text-secondary">Sessions</h2>
        <span className="text-xs text-text-disabled">
          {projectSessions.length}
        </span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {projectSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            tick={tick}
            isRenaming={session.id === renamingSessionId}
            onRenameComplete={() => setRenamingSessionId(null)}
            onContextMenu={handleContextMenu}
            onDoubleClickName={(sessionId) => setRenamingSessionId(sessionId)}
          />
        ))}
      </div>

      {/* New session area */}
      <div className="border-t border-border">
        {showInput ? (
          <NewSessionInput projectId={projectId} onDone={handleInputDone} />
        ) : (
          <button
            type="button"
            onClick={handleNewSession}
            className="w-full bg-btn-primary-bg px-3 py-2 text-sm font-medium text-btn-primary-text transition-colors hover:bg-btn-primary-bg-hover"
          >
            + New Session
          </button>
        )}
      </div>

      {showSettings && (
        <ProjectSettings
          projectId={projectId}
          projectName={projectName}
          projectPath={projectPath}
          onClose={() => setShowSettings(false)}
        />
      )}

      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default SessionPanel;
