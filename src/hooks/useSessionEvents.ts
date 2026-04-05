import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    // Subscribe to all events, tracking cleanup functions.
    const id = sessionId;
    Promise.all([
      listen<StatusPayload>(`session-status-${id}`, (event) => {
        if (!cancelled) {
          useSessionStore
            .getState()
            .updateStatus(
              event.payload.sessionId,
              event.payload.status,
              event.payload.message,
            );
        }
      }),
      listen<{ sessionId: string }>(`session-exited-${id}`, (event) => {
        if (!cancelled) {
          useSessionStore
            .getState()
            .updateStatus(event.payload.sessionId, "exited");
        }
      }),
      listen<NamePayload>(`session-name-updated-${id}`, (event) => {
        if (!cancelled) {
          useSessionStore
            .getState()
            .updateName(event.payload.sessionId, event.payload.name);
        }
      }),
    ]).then((fns) => {
      if (cancelled) {
        // Component unmounted before listeners registered — clean up immediately
        fns.forEach((fn) => fn());
      } else {
        unlisteners.push(...fns);
      }
    });

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [sessionId]);
}
