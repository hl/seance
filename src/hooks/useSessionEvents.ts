import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessionStore";
import type { SessionStatus } from "../stores/sessionStore";

interface StatusPayload {
  sessionId: string;
  status: SessionStatus;
  message?: string;
}

interface NamePayload {
  sessionId: string;
  name: string;
}

/**
 * Subscribes to Tauri events for session status changes, exits, and name updates.
 * Listeners are scoped to a specific session and cleaned up on unmount.
 */
export function useSessionEvents(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId) return;

    const unlisteners: Array<() => void> = [];

    async function subscribe() {
      if (!sessionId) return;

      const unStatus = await listen<StatusPayload>(
        `session-status-${sessionId}`,
        (event) => {
          useSessionStore
            .getState()
            .updateStatus(
              event.payload.sessionId,
              event.payload.status,
              event.payload.message,
            );
        },
      );
      unlisteners.push(unStatus);

      const unExited = await listen<{ sessionId: string }>(
        `session-exited-${sessionId}`,
        (event) => {
          useSessionStore
            .getState()
            .updateStatus(event.payload.sessionId, "exited");
        },
      );
      unlisteners.push(unExited);

      const unName = await listen<NamePayload>(
        `session-name-updated-${sessionId}`,
        (event) => {
          useSessionStore
            .getState()
            .updateName(event.payload.sessionId, event.payload.name);
        },
      );
      unlisteners.push(unName);
    }

    subscribe();

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [sessionId]);
}
