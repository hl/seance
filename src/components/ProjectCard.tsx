import { type FC, useCallback } from "react";
import AvatarStack from "./AvatarStack";

interface ProjectCardProps {
  name: string;
  path: string;
  activeSessionCount: number;
  sessionIds: string[];
  onClick: () => void;
  onRemove: () => void;
  onSettings: () => void;
}

const ProjectCard: FC<ProjectCardProps> = ({
  name,
  path,
  activeSessionCount,
  sessionIds,
  onClick,
  onRemove,
  onSettings,
}) => {
  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove();
    },
    [onRemove],
  );

  const handleSettings = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSettings();
    },
    [onSettings],
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
    >
      {/* Top row: name + actions */}
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-text">
          {name}
        </h3>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleSettings}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-interactive-hover hover:text-text-secondary-hover"
            title="Project settings"
          >
            &#9881;
          </button>
          <button
            type="button"
            onClick={handleRemove}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-red-100/50 hover:text-red-700 dark:hover:bg-red-900/50 dark:hover:text-red-400"
            title="Remove project"
          >
            &#10005;
          </button>
        </div>
      </div>

      {/* Path */}
      <p className="mt-1 truncate text-xs text-text-muted">{path}</p>

      {/* Bottom row: session counts + avatar stack */}
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-full bg-surface-badge px-2 py-0.5 text-xs text-text-secondary">
          {activeSessionCount} active
        </span>
        {sessionIds.length - activeSessionCount > 0 && (
          <span className="rounded-full bg-surface-badge px-2 py-0.5 text-xs text-text-disabled">
            {sessionIds.length - activeSessionCount} inactive
          </span>
        )}
        <AvatarStack sessionIds={sessionIds} />
      </div>
    </button>
  );
};

export default ProjectCard;
