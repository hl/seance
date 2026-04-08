import { useEffect, useRef, useMemo } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessionStore";
import type { SessionStatus } from "../stores/sessionStore";

interface StatusPayload {
  sessionId: string;
  status: SessionStatus;
  lastMessage?: string;
}

interface ExitedPayload {
  sessionId: string;
  exitCode?: number;
  exitedAt?: string;
}

interface WorkingDirPayload {
  sessionId: string;
  workingDir: string;
  baseCommit: string | null;
}

/**
 * Subscribes to Tauri events for ALL sessions in the given project.
 * When the session list changes, diffs the IDs and only adds/removes
 * listeners for changed sessions (no full teardown).
 */
export function useProjectSessionEvents(projectId: string): void {
  const sessions = useSessionStore((s) => s.sessions);

  // Derive a stable set of session IDs for this project.
  // Only changes when sessions are added/removed, not on status updates.
  const projectSessionIds = useMemo(() => {
    const ids: string[] = [];
    for (const [id, session] of sessions) {
      if (session.projectId === projectId) ids.push(id);
    }
    return ids;
  }, [sessions, projectId]);

  // Track active listeners keyed by session ID
  const listenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  // Track whether the component is still mounted
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const currentIds = new Set<string>(projectSessionIds);
    const prevIds = new Set(listenersRef.current.keys());

    // Determine which sessions were added or removed
    const added = new Set<string>();
    const removed = new Set<string>();

    for (const id of currentIds) {
      if (!prevIds.has(id)) {
        added.add(id);
      }
    }
    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        removed.add(id);
      }
    }

    // Unsubscribe removed sessions
    for (const id of removed) {
      const fns = listenersRef.current.get(id);
      if (fns) {
        for (const fn of fns) {
          fn();
        }
      }
      listenersRef.current.delete(id);
    }

    // Subscribe to added sessions
    for (const id of added) {
      const unlisteners: UnlistenFn[] = [];
      // Reserve the slot so subsequent renders see it as "already tracked"
      listenersRef.current.set(id, unlisteners);

      Promise.all([
        listen<StatusPayload>(`session-status-${id}`, (event) => {
          if (mountedRef.current) {
            useSessionStore
              .getState()
              .updateStatus(
                event.payload.sessionId,
                event.payload.status,
                event.payload.lastMessage,
              );
          }
        }),
        listen<ExitedPayload>(`session-exited-${id}`, (event) => {
          if (mountedRef.current) {
            const { sessionId, exitCode, exitedAt } = event.payload;
            const parsedExitedAt = exitedAt
              ? parseInt(exitedAt, 10) * 1000
              : undefined;
            useSessionStore
              .getState()
              .updateStatus(
                sessionId,
                "exited",
                undefined,
                exitCode,
                parsedExitedAt,
              );
          }
        }),
        listen<WorkingDirPayload>(`session-working-dir-${id}`, (event) => {
          if (mountedRef.current) {
            useSessionStore
              .getState()
              .updateWorkingDir(
                event.payload.sessionId,
                event.payload.workingDir,
                event.payload.baseCommit,
              );
          }
        }),
      ]).then((fns) => {
        if (!mountedRef.current) {
          // Component unmounted before listeners registered — clean up immediately
          fns.forEach((fn) => fn());
          listenersRef.current.delete(id);
        } else {
          unlisteners.push(...fns);
        }
      });
    }

    // Cleanup on unmount: tear down ALL remaining listeners
    return () => {
      // Only do full teardown on actual unmount, not on re-renders.
      // We detect unmount by checking mountedRef (set to false in the
      // separate cleanup effect above).
      // On re-renders, the diff logic above handles incremental changes.
    };
  }, [projectSessionIds]);

  // Full teardown on unmount
  useEffect(() => {
    return () => {
      for (const [, fns] of listenersRef.current) {
        for (const fn of fns) {
          fn();
        }
      }
      listenersRef.current.clear();
    };
  }, []);
}
