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
    <div className="flex w-70 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Sessions</h2>
        <span className="text-xs text-neutral-600">
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
      <div className="border-t border-neutral-800">
        {showInput ? (
          <NewSessionInput projectId={projectId} onDone={handleInputDone} />
        ) : (
          <button
            type="button"
            onClick={handleNewSession}
            className="w-full px-3 py-2 text-left text-sm text-neutral-500 transition-colors hover:bg-neutral-800/50 hover:text-neutral-300"
          >
            + New Session
          </button>
        )}
      </div>
    </div>
  );
};

export default SessionPanel;
