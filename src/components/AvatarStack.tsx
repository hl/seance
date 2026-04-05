import { type FC } from "react";
import SessionAvatar from "./SessionAvatar";

interface AvatarStackProps {
  sessionIds: string[];
  maxVisible?: number;
}

const AvatarStack: FC<AvatarStackProps> = ({
  sessionIds,
  maxVisible = 5,
}) => {
  if (sessionIds.length === 0) return null;

  const visible = sessionIds.slice(0, maxVisible);
  const overflow = sessionIds.length - maxVisible;

  return (
    <div className="flex items-center">
      {visible.map((id, index) => (
        <div
          key={id}
          className="rounded-full border border-neutral-900"
          style={{ marginLeft: index === 0 ? 0 : -4 }}
        >
          <SessionAvatar uuid={id} size={16} />
        </div>
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-xs text-neutral-500">+{overflow}</span>
      )}
    </div>
  );
};

export default AvatarStack;
