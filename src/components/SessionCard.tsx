import { type FC, useCallback } from "react";
import SessionAvatar from "./SessionAvatar";
import StatusIndicator from "./StatusIndicator";
import type { SessionData } from "../stores/sessionStore";
import { useSessionStore } from "../stores/sessionStore";

interface SessionCardProps {
  session: SessionData;
  isActive: boolean;
}

const SessionCard: FC<SessionCardProps> = ({ session, isActive }) => {
  const switchSession = useSessionStore((s) => s.switchSession);
  const killSession = useSessionStore((s) => s.killSession);
  const restartSession = useSessionStore((s) => s.restartSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  const handleClick = useCallback(() => {
    switchSession(session.id);
  }, [switchSession, session.id]);

  const handleKill = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      killSession(session.id);
    },
    [killSession, session.id],
  );

  const handleRestart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      restartSession(session.id);
    },
    [restartSession, session.id],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteSession(session.id);
    },
    [deleteSession, session.id],
  );

  const isAlive = session.status !== "exited" && session.status !== "done";
  const canRestart = session.status === "exited";
  const canDelete = !isAlive;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`group w-full rounded-md px-3 py-2 text-left transition-colors ${
        isActive
          ? "bg-surface-active"
          : "hover:bg-surface-subtle"
      }`}
    >
      {/* Row 1: Avatar + Name + Status */}
      <div className="flex items-center gap-2">
        <SessionAvatar uuid={session.id} size={20} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {session.generatedName}
        </span>
        <StatusIndicator status={session.status} />
        {isAlive && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleKill}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                killSession(session.id);
              }
            }}
            className="ml-1 hidden rounded px-1 text-xs text-text-muted hover:bg-interactive-hover hover:text-text-secondary-hover group-hover:inline-block"
            title="Kill session"
          >
            ✕
          </span>
        )}
        {canRestart && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleRestart}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                restartSession(session.id);
              }
            }}
            className="ml-1 hidden rounded px-1 text-xs text-text-muted hover:bg-interactive-hover hover:text-text-secondary-hover group-hover:inline-block"
            title="Restart session"
          >
            ↻
          </span>
        )}
        {canDelete && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleDelete}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                deleteSession(session.id);
              }
            }}
            className="ml-1 hidden rounded px-1 text-xs text-text-muted hover:bg-red-100/50 hover:text-red-700 dark:hover:bg-red-900/50 dark:hover:text-red-400 group-hover:inline-block"
            title="Remove session"
          >
            ✕
          </span>
        )}
      </div>

      {/* Row 2: Task */}
      <p className="mt-0.5 truncate pl-7 text-xs text-text-muted">
        {session.task}
      </p>

      {/* Row 3: Last message (active card only) */}
      {isActive && session.lastMessage && (
        <p className="mt-0.5 truncate pl-7 text-xs text-text-disabled">
          {session.lastMessage}
        </p>
      )}
    </button>
  );
};

export default SessionCard;
