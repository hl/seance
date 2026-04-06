import { type FC, useCallback, useEffect, useRef, useState } from "react";
import SessionAvatar from "./SessionAvatar";
import StatusIndicator from "./StatusIndicator";
import type { SessionData } from "../stores/sessionStore";
import { useSessionStore } from "../stores/sessionStore";

interface SessionCardProps {
  session: SessionData;
  isActive: boolean;
  tick: number;
  isRenaming: boolean;
  onRenameComplete: () => void;
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void;
  onDoubleClickName: (sessionId: string) => void;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCreatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SessionCard: FC<SessionCardProps> = ({
  session,
  isActive,
  tick,
  isRenaming,
  onRenameComplete,
  onContextMenu,
  onDoubleClickName,
}) => {
  const switchSession = useSessionStore((s) => s.switchSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  const [renameValue, setRenameValue] = useState(session.generatedName);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // When entering rename mode, reset value and focus/select the input
  useEffect(() => {
    if (isRenaming) {
      setRenameValue(session.generatedName);
      // Focus after render
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, session.generatedName]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.generatedName) {
      renameSession(session.id, trimmed);
    }
    onRenameComplete();
  }, [renameValue, session.generatedName, session.id, renameSession, onRenameComplete]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onRenameComplete();
      }
    },
    [handleRenameSubmit, onRenameComplete],
  );

  const handleClick = useCallback(() => {
    if (isRenaming) return;
    switchSession(session.id);
  }, [switchSession, session.id, isRenaming]);

  const isAlive = session.status !== "exited" && session.status !== "done";

  // Elapsed time computation — `tick` triggers re-render every second
  let elapsedText: string | null = null;
  if (session.lastStartedAt !== null) {
    // Reference tick to satisfy the linter; Date.now() uses the current time
    // which changes each render (triggered by tick incrementing in the parent).
    void tick;
    const elapsedMs = isAlive
      ? Date.now() - session.lastStartedAt
      : session.exitedAt !== null
        ? session.exitedAt - session.lastStartedAt
        : 0;
    elapsedText = formatElapsed(elapsedMs);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, session.id);
      }}
      className={`w-full px-3 py-2 text-left transition-colors ${
        isActive
          ? "bg-surface-active"
          : "hover:bg-surface-subtle"
      }`}
    >
      {/* Line 1: Avatar + Name + Status + Exit code + Elapsed time */}
      <div className="flex items-center gap-2">
        <SessionAvatar uuid={session.id} size={20} />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={onRenameComplete}
            className="min-w-0 flex-1 border border-border-input bg-surface px-1 py-0 text-sm font-medium text-text outline-none focus:ring-1 focus:ring-ring-focus"
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium text-text"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onDoubleClickName(session.id);
            }}
          >
            {session.generatedName}
          </span>
        )}
        <StatusIndicator status={session.status} />
        {session.exitCode != null && session.exitCode !== 0 && (
          <span className="text-xs text-red-500">[{session.exitCode}]</span>
        )}
        {elapsedText !== null && (
          <span className="shrink-0 text-xs text-text-muted">{elapsedText}</span>
        )}
      </div>

      {/* Line 2: Task + Created-at */}
      <div className="mt-0.5 flex items-baseline gap-2 pl-7">
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
          {session.task}
        </span>
        <span className="shrink-0 text-xs text-text-disabled">
          {formatCreatedAt(session.createdAt)}
        </span>
      </div>

      {/* Line 3 (conditional): Last message */}
      {session.lastMessage && (
        <p className="mt-0.5 truncate pl-7 text-xs text-text-disabled">
          {session.lastMessage}
        </p>
      )}
    </button>
  );
};

export default SessionCard;
