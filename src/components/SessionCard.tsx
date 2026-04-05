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
          ? "bg-neutral-800"
          : "hover:bg-neutral-800/50"
      }`}
    >
      {/* Row 1: Avatar + Name + Status */}
      <div className="flex items-center gap-2">
        <SessionAvatar uuid={session.id} size={20} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
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
            className="ml-1 hidden rounded px-1 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300 group-hover:inline-block"
            title="Kill agent"
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
            className="ml-1 hidden rounded px-1 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300 group-hover:inline-block"
            title="Restart agent"
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
            className="ml-1 hidden rounded px-1 text-xs text-neutral-500 hover:bg-red-900/50 hover:text-red-400 group-hover:inline-block"
            title="Remove agent"
          >
            ✕
          </span>
        )}
      </div>

      {/* Row 2: Task */}
      <p className="mt-0.5 truncate pl-7 text-xs text-neutral-500">
        {session.task}
      </p>

      {/* Row 3: Last message (active card only) */}
      {isActive && session.lastMessage && (
        <p className="mt-0.5 truncate pl-7 text-xs text-neutral-600">
          {session.lastMessage}
        </p>
      )}
    </button>
  );
};

export default SessionCard;
