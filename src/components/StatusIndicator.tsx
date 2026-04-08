import { type FC } from "react";
import type { SessionStatus } from "../stores/sessionStore";

interface StatusIndicatorProps {
  status: SessionStatus;
}

const STATUS_CONFIG: Record<
  SessionStatus,
  { color: string; pulse: boolean }
> = {
  running: { color: "bg-green-500", pulse: true },
  thinking: { color: "bg-amber-500", pulse: true },
  waiting: { color: "bg-blue-500", pulse: false },
  done: { color: "bg-status-done", pulse: false },
  error: { color: "bg-red-500", pulse: false },
  exited: { color: "bg-status-exited", pulse: false },
};

const StatusIndicator: FC<StatusIndicatorProps> = ({ status }) => {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${config.color} ${config.pulse ? "animate-pulse-status" : ""}`}
      role="status"
      aria-label={status}
      title={status}
      data-testid="status-indicator"
      data-status={status}
    />
  );
};

export default StatusIndicator;
