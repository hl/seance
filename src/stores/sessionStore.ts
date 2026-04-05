import { create } from "zustand";

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

interface SessionState {
  sessions: Map<string, SessionData>;
  activeSessionId: string | null;
  activeProjectId: string | null;

  createSession: (projectId: string, task: string) => string;
  switchSession: (sessionId: string) => void;
  killSession: (sessionId: string) => void;
  restartSession: (sessionId: string) => void;
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

function generateUUID(): string {
  return crypto.randomUUID();
}

function placeholderName(uuid: string): string {
  return `Agent-${uuid.slice(0, 8)}`;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  activeProjectId: null,

  createSession: (projectId: string, task: string) => {
    const id = generateUUID();
    const session: SessionData = {
      id,
      projectId,
      task,
      generatedName: placeholderName(id),
      status: "running",
      lastMessage: "",
      createdAt: Date.now(),
    };
    set((state) => {
      const next = new Map(state.sessions);
      next.set(id, session);
      return { sessions: next, activeSessionId: id };
    });
    return id;
  },

  switchSession: (sessionId: string) => {
    const { sessions } = get();
    if (sessions.has(sessionId)) {
      set({ activeSessionId: sessionId });
    }
  },

  killSession: (sessionId: string) => {
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

  restartSession: (sessionId: string) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(sessionId);
      if (session) {
        next.set(sessionId, {
          ...session,
          status: "running",
          lastMessage: "",
        });
      }
      return { sessions: next };
    });
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
    // Will be wired to Tauri backend in a later unit.
    // For now, clears sessions for the given project context.
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
