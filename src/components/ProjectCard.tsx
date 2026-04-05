import { type FC, useCallback } from "react";
import AvatarStack from "./AvatarStack";

interface ProjectCardProps {
  id: string;
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
      className="group relative w-full rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-left transition-colors hover:bg-neutral-800"
    >
      {/* Top row: name + actions */}
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-neutral-100">
          {name}
        </h3>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <span
            role="button"
            tabIndex={0}
            onClick={handleSettings}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onSettings();
              }
            }}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
            title="Project settings"
          >
            &#9881;
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={handleRemove}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onRemove();
              }
            }}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-red-900/50 hover:text-red-400"
            title="Remove project"
          >
            &#10005;
          </span>
        </div>
      </div>

      {/* Path */}
      <p className="mt-1 truncate text-xs text-neutral-500">{path}</p>

      {/* Bottom row: session count + avatar stack */}
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
          {activeSessionCount}{" "}
          {activeSessionCount === 1 ? "session" : "sessions"}
        </span>
        <AvatarStack sessionIds={sessionIds} />
      </div>
    </button>
  );
};

export default ProjectCard;
