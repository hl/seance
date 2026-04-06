import { type FC, useState, useCallback, useMemo } from "react";
import { useSessionStore } from "../stores/sessionStore";
import SessionCard from "./SessionCard";
import NewSessionInput from "./NewSessionInput";

interface SessionPanelProps {
  projectId: string;
}

const SessionPanel: FC<SessionPanelProps> = ({ projectId }) => {
  const [showInput, setShowInput] = useState(false);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const projectSessions = useMemo(() => {
    return Array.from(sessions.values())
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [sessions, projectId]);

  const handleNewSession = useCallback(() => {
    setShowInput(true);
  }, []);

  const handleInputDone = useCallback(() => {
    setShowInput(false);
  }, []);

  return (
    <div className="flex w-70 shrink-0 flex-col border-l border-border bg-bg">
      {/* Header */}
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
            className="w-full px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-secondary-hover"
          >
            + New Session
          </button>
        )}
      </div>
    </div>
  );
};

export default SessionPanel;
