import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type SessionStatus =
  | "running"
  | "thinking"
  | "waiting"
  | "done"
  | "error"
  | "exited";

export interface SessionData {
  id: string;
  projectId: string;
  task: string;
  generatedName: string;
  status: SessionStatus;
  lastMessage: string;
  createdAt: number;
}

// Backend response shape from create_session / restart_session
interface BackendSession {
  id: string;
  project_id: string;
  task: string;
  generated_name: string;
  status: SessionStatus;
  last_message: string | null;
  created_at: string;
  last_started_at: string | null;
  last_known_pid: number | null;
}

function backendToFrontend(s: BackendSession): SessionData {
  return {
    id: s.id,
    projectId: s.project_id,
    task: s.task,
    generatedName: s.generated_name,
    status: s.status,
    lastMessage: s.last_message ?? "",
    createdAt: parseInt(s.created_at, 10) * 1000 || Date.now(),
  };
}

interface SessionState {
  sessions: Map<string, SessionData>;
  activeSessionId: string | null;
  activeProjectId: string | null;

  createSession: (projectId: string, task: string) => Promise<string>;
  switchSession: (sessionId: string) => void;
  killSession: (sessionId: string) => Promise<void>;
  restartSession: (sessionId: string) => Promise<void>;
  updateStatus: (
    sessionId: string,
    status: SessionStatus,
    message?: string,
  ) => void;
  updateName: (sessionId: string, name: string) => void;
  setActiveProject: (projectId: string | null) => void;
  loadSessions: (projectId: string) => void;
  switchToIndex: (index: number) => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  activeProjectId: null,

  createSession: async (projectId: string, task: string) => {
    // Call the backend to spawn the PTY. The Channel for output streaming
    // is handled separately by the Terminal component's subscribe_output call
    // when activeSessionId changes.
    const backendSession = await invoke<BackendSession>("create_session", {
      projectId,
      task,
    });

    const session = backendToFrontend(backendSession);

    set((state) => {
      const next = new Map(state.sessions);
      next.set(session.id, session);
      return { sessions: next, activeSessionId: session.id };
    });

    return session.id;
  },

  switchSession: (sessionId: string) => {
    const { sessions } = get();
    if (sessions.has(sessionId)) {
      set({ activeSessionId: sessionId });
    }
  },

  killSession: async (sessionId: string) => {
    try {
      await invoke("kill_session", { sessionId });
    } catch (err) {
      console.error("Failed to kill session:", err);
    }
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(sessionId);
      if (session) {
        next.set(sessionId, { ...session, status: "exited" });
      }
      const newActive =
        state.activeSessionId === sessionId ? null : state.activeSessionId;
      return { sessions: next, activeSessionId: newActive };
    });
  },

  restartSession: async (sessionId: string) => {
    try {
      const backendSession = await invoke<BackendSession>("restart_session", {
        sessionId,
      });
      const session = backendToFrontend(backendSession);
      set((state) => {
        const next = new Map(state.sessions);
        next.set(session.id, session);
        return { sessions: next, activeSessionId: session.id };
      });
    } catch (err) {
      console.error("Failed to restart session:", err);
    }
  },

  updateStatus: (
    sessionId: string,
    status: SessionStatus,
    message?: string,
  ) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(sessionId);
      if (session) {
        next.set(sessionId, {
          ...session,
          status,
          lastMessage: message ?? session.lastMessage,
        });
      }
      return { sessions: next };
    });
  },

  updateName: (sessionId: string, name: string) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(sessionId);
      if (session) {
        next.set(sessionId, { ...session, generatedName: name });
      }
      return { sessions: next };
    });
  },

  setActiveProject: (projectId: string | null) => {
    set({ activeProjectId: projectId });
  },

  loadSessions: (_projectId: string) => {
    set({ sessions: new Map(), activeSessionId: null });
  },

  switchToIndex: (index: number) => {
    const { sessions, activeProjectId } = get();
    const projectSessions = Array.from(sessions.values())
      .filter((s) => s.projectId === activeProjectId)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (index >= 0 && index < projectSessions.length) {
      set({ activeSessionId: projectSessions[index].id });
    }
  },
}));
