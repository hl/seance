import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core before importing the store
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../sessionStore";
import type { SessionData } from "../sessionStore";

const mockedInvoke = vi.mocked(invoke);

// Helper: create a minimal BackendSession object
function makeBackendSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    project_id: "p1",
    task: "do stuff",
    generated_name: "Session 1",
    status: "running",
    last_message: null,
    created_at: "1712345678",
    last_started_at: null,
    last_known_pid: null,
    exited_at: null,
    exit_code: null,
    working_dir: "/tmp",
    base_commit: null,
    ...overrides,
  };
}

// Helper: create a minimal frontend SessionData object
function makeSessionData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: "s1",
    projectId: "p1",
    task: "do stuff",
    generatedName: "Session 1",
    status: "running",
    lastMessage: "",
    createdAt: 1712345678000,
    lastStartedAt: null,
    exitedAt: null,
    exitCode: null,
    workingDir: "/tmp",
    baseCommit: null,
    ...overrides,
  };
}

// Seed the store with one or more sessions for tests that need pre-existing data
function seedSessions(...sessions: SessionData[]) {
  const map = new Map<string, SessionData>();
  for (const s of sessions) {
    map.set(s.id, s);
  }
  useSessionStore.setState({ sessions: map });
}

describe("sessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      activeProjectId: null,
      activeTabBySession: new Map(),
    });
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // backendToFrontend mapping (tested through loadSessions)
  // -------------------------------------------------------------------
  describe("backendToFrontend mapping", () => {
    it("converts snake_case timestamps to camelCase with epoch seconds * 1000", async () => {
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({
          created_at: "1712345678",
          last_started_at: "1712345700",
          exited_at: "1712345800",
          exit_code: 0,
        }),
      ]);

      await useSessionStore.getState().loadSessions("p1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.createdAt).toBe(1712345678000);
      expect(session.lastStartedAt).toBe(1712345700000);
      expect(session.exitedAt).toBe(1712345800000);
      expect(session.exitCode).toBe(0);
    });

    it("converts null last_message to empty string", async () => {
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ last_message: null }),
      ]);

      await useSessionStore.getState().loadSessions("p1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.lastMessage).toBe("");
    });

    it("preserves non-null last_message", async () => {
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ last_message: "hello world" }),
      ]);

      await useSessionStore.getState().loadSessions("p1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.lastMessage).toBe("hello world");
    });

    it("falls back to Date.now() when created_at is empty", async () => {
      const before = Date.now();
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ created_at: "" }),
      ]);

      await useSessionStore.getState().loadSessions("p1");
      const after = Date.now();

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
    });

    it("falls back to Date.now() when created_at is not a number", async () => {
      const before = Date.now();
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ created_at: "not-a-number" }),
      ]);

      await useSessionStore.getState().loadSessions("p1");
      const after = Date.now();

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
    });

    it("sets lastStartedAt to null when last_started_at is null", async () => {
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ last_started_at: null }),
      ]);

      await useSessionStore.getState().loadSessions("p1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.lastStartedAt).toBeNull();
    });

    it("sets exitedAt to null when exited_at is null", async () => {
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ exited_at: null }),
      ]);

      await useSessionStore.getState().loadSessions("p1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.exitedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // switchSession
  // -------------------------------------------------------------------
  describe("switchSession", () => {
    it("sets activeSessionId when the session exists", () => {
      seedSessions(makeSessionData({ id: "s1" }));

      useSessionStore.getState().switchSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBe("s1");
    });

    it("does nothing for an unknown session ID", () => {
      seedSessions(makeSessionData({ id: "s1" }));
      useSessionStore.setState({ activeSessionId: "s1" });

      useSessionStore.getState().switchSession("unknown");

      expect(useSessionStore.getState().activeSessionId).toBe("s1");
    });

    it("does nothing when sessions map is empty", () => {
      useSessionStore.getState().switchSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------
  describe("updateStatus", () => {
    it("updates status and lastMessage for an existing session", () => {
      seedSessions(makeSessionData({ id: "s1", status: "running", lastMessage: "" }));

      useSessionStore.getState().updateStatus("s1", "thinking", "Processing...");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.status).toBe("thinking");
      expect(session.lastMessage).toBe("Processing...");
    });

    it("keeps the previous lastMessage when message is undefined", () => {
      seedSessions(makeSessionData({ id: "s1", lastMessage: "keep me" }));

      useSessionStore.getState().updateStatus("s1", "waiting");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.lastMessage).toBe("keep me");
    });

    it("preserves other fields when updating status", () => {
      seedSessions(
        makeSessionData({
          id: "s1",
          task: "important task",
          generatedName: "My Session",
          workingDir: "/home",
        }),
      );

      useSessionStore.getState().updateStatus("s1", "done", "Completed");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.task).toBe("important task");
      expect(session.generatedName).toBe("My Session");
      expect(session.workingDir).toBe("/home");
    });

    it("handles missing session gracefully (no throw)", () => {
      expect(() => {
        useSessionStore.getState().updateStatus("nonexistent", "error", "fail");
      }).not.toThrow();

      expect(useSessionStore.getState().sessions.size).toBe(0);
    });

    it("merges exitCode and exitedAt when provided", () => {
      seedSessions(makeSessionData({ id: "s1" }));

      useSessionStore.getState().updateStatus("s1", "exited", "Done", 0, 1700000000000);

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.exitCode).toBe(0);
      expect(session.exitedAt).toBe(1700000000000);
    });

    it("preserves existing exitCode and exitedAt when not provided", () => {
      seedSessions(
        makeSessionData({ id: "s1", exitCode: 1, exitedAt: 1600000000000 }),
      );

      useSessionStore.getState().updateStatus("s1", "exited", "Re-checked");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.exitCode).toBe(1);
      expect(session.exitedAt).toBe(1600000000000);
    });
  });

  // -------------------------------------------------------------------
  // updateName
  // -------------------------------------------------------------------
  describe("updateName", () => {
    it("updates generatedName for an existing session", () => {
      seedSessions(makeSessionData({ id: "s1", generatedName: "Old Name" }));

      useSessionStore.getState().updateName("s1", "New Name");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.generatedName).toBe("New Name");
    });

    it("does not throw for a nonexistent session", () => {
      expect(() => {
        useSessionStore.getState().updateName("nonexistent", "Name");
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // updateWorkingDir
  // -------------------------------------------------------------------
  describe("updateWorkingDir", () => {
    it("updates workingDir and baseCommit for an existing session", () => {
      seedSessions(makeSessionData({ id: "s1", workingDir: "/old", baseCommit: null }));

      useSessionStore.getState().updateWorkingDir("s1", "/new/path", "abc123");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.workingDir).toBe("/new/path");
      expect(session.baseCommit).toBe("abc123");
    });

    it("sets baseCommit to null when passed null", () => {
      seedSessions(makeSessionData({ id: "s1", baseCommit: "oldcommit" }));

      useSessionStore.getState().updateWorkingDir("s1", "/path", null);

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.baseCommit).toBeNull();
    });

    it("does not throw for a nonexistent session", () => {
      expect(() => {
        useSessionStore.getState().updateWorkingDir("nonexistent", "/path", null);
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // killSession
  // -------------------------------------------------------------------
  describe("killSession", () => {
    it("calls invoke with correct arguments", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().killSession("s1");

      expect(mockedInvoke).toHaveBeenCalledWith("kill_session", { sessionId: "s1" });
    });

    it("marks the session as exited", async () => {
      seedSessions(makeSessionData({ id: "s1", status: "running" }));
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().killSession("s1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.status).toBe("exited");
    });

    it("nulls activeSessionId when the killed session was active", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      useSessionStore.setState({ activeSessionId: "s1" });
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().killSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it("preserves activeSessionId when a different session was active", async () => {
      seedSessions(
        makeSessionData({ id: "s1" }),
        makeSessionData({ id: "s2" }),
      );
      useSessionStore.setState({ activeSessionId: "s2" });
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().killSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBe("s2");
    });

    it("still marks session as exited even when invoke rejects", async () => {
      seedSessions(makeSessionData({ id: "s1", status: "running" }));
      useSessionStore.setState({ activeSessionId: "s1" });
      mockedInvoke.mockRejectedValueOnce(new Error("backend error"));

      await useSessionStore.getState().killSession("s1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.status).toBe("exited");
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // deleteSession
  // -------------------------------------------------------------------
  describe("deleteSession", () => {
    it("calls invoke with correct arguments", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().deleteSession("s1");

      expect(mockedInvoke).toHaveBeenCalledWith("delete_session", { sessionId: "s1" });
    });

    it("removes the session from the map", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().deleteSession("s1");

      expect(useSessionStore.getState().sessions.has("s1")).toBe(false);
      expect(useSessionStore.getState().sessions.size).toBe(0);
    });

    it("nulls activeSessionId when the deleted session was active", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      useSessionStore.setState({ activeSessionId: "s1" });
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().deleteSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it("preserves activeSessionId when a different session was active", async () => {
      seedSessions(
        makeSessionData({ id: "s1" }),
        makeSessionData({ id: "s2" }),
      );
      useSessionStore.setState({ activeSessionId: "s2" });
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().deleteSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBe("s2");
      expect(useSessionStore.getState().sessions.has("s1")).toBe(false);
      expect(useSessionStore.getState().sessions.has("s2")).toBe(true);
    });

    it("still removes session from map even when invoke rejects", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      mockedInvoke.mockRejectedValueOnce(new Error("backend error"));

      await useSessionStore.getState().deleteSession("s1");

      expect(useSessionStore.getState().sessions.has("s1")).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // loadSessions
  // -------------------------------------------------------------------
  describe("loadSessions", () => {
    it("populates sessions map from backend response", async () => {
      mockedInvoke.mockResolvedValueOnce([
        makeBackendSession({ id: "s1" }),
        makeBackendSession({ id: "s2", generated_name: "Session 2" }),
      ]);

      await useSessionStore.getState().loadSessions("p1");

      const { sessions } = useSessionStore.getState();
      expect(sessions.size).toBe(2);
      expect(sessions.has("s1")).toBe(true);
      expect(sessions.has("s2")).toBe(true);
      expect(sessions.get("s2")!.generatedName).toBe("Session 2");
    });

    it("clears activeSessionId", async () => {
      useSessionStore.setState({ activeSessionId: "old-session" });
      mockedInvoke.mockResolvedValueOnce([makeBackendSession()]);

      await useSessionStore.getState().loadSessions("p1");

      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it("sets activeProjectId to the given project", async () => {
      mockedInvoke.mockResolvedValueOnce([]);

      await useSessionStore.getState().loadSessions("project-42");

      expect(useSessionStore.getState().activeProjectId).toBe("project-42");
    });

    it("calls invoke with correct command and arguments", async () => {
      mockedInvoke.mockResolvedValueOnce([]);

      await useSessionStore.getState().loadSessions("p1");

      expect(mockedInvoke).toHaveBeenCalledWith("list_sessions", { projectId: "p1" });
    });

    it("falls back to empty sessions when invoke rejects", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      mockedInvoke.mockRejectedValueOnce(new Error("backend unavailable"));

      await useSessionStore.getState().loadSessions("p1");

      expect(useSessionStore.getState().sessions.size).toBe(0);
      expect(useSessionStore.getState().activeSessionId).toBeNull();
      expect(useSessionStore.getState().activeProjectId).toBe("p1");
    });
  });

  // -------------------------------------------------------------------
  // switchToIndex
  // -------------------------------------------------------------------
  describe("switchToIndex", () => {
    it("switches to session by creation-order index within active project", () => {
      seedSessions(
        makeSessionData({ id: "s1", projectId: "p1", createdAt: 1000 }),
        makeSessionData({ id: "s2", projectId: "p1", createdAt: 2000 }),
        makeSessionData({ id: "s3", projectId: "p1", createdAt: 3000 }),
      );
      useSessionStore.setState({ activeProjectId: "p1" });

      useSessionStore.getState().switchToIndex(1);

      expect(useSessionStore.getState().activeSessionId).toBe("s2");
    });

    it("only considers sessions in the active project", () => {
      seedSessions(
        makeSessionData({ id: "s1", projectId: "p1", createdAt: 1000 }),
        makeSessionData({ id: "s2", projectId: "p2", createdAt: 2000 }),
        makeSessionData({ id: "s3", projectId: "p1", createdAt: 3000 }),
      );
      useSessionStore.setState({ activeProjectId: "p1" });

      // Index 1 in project p1 should be s3 (second p1 session by createdAt)
      useSessionStore.getState().switchToIndex(1);

      expect(useSessionStore.getState().activeSessionId).toBe("s3");
    });

    it("does nothing for out-of-bounds positive index", () => {
      seedSessions(makeSessionData({ id: "s1", projectId: "p1" }));
      useSessionStore.setState({ activeProjectId: "p1", activeSessionId: "s1" });

      useSessionStore.getState().switchToIndex(5);

      expect(useSessionStore.getState().activeSessionId).toBe("s1");
    });

    it("does nothing for negative index", () => {
      seedSessions(makeSessionData({ id: "s1", projectId: "p1" }));
      useSessionStore.setState({ activeProjectId: "p1", activeSessionId: "s1" });

      useSessionStore.getState().switchToIndex(-1);

      expect(useSessionStore.getState().activeSessionId).toBe("s1");
    });

    it("does nothing when no sessions exist for the active project", () => {
      seedSessions(makeSessionData({ id: "s1", projectId: "p2" }));
      useSessionStore.setState({ activeProjectId: "p1" });

      useSessionStore.getState().switchToIndex(0);

      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // setActiveTab / getActiveTab
  // -------------------------------------------------------------------
  describe("setActiveTab / getActiveTab", () => {
    it("defaults to 'terminal' when no tab has been set", () => {
      expect(useSessionStore.getState().getActiveTab("s1")).toBe("terminal");
    });

    it("sets and retrieves the active tab for a session", () => {
      useSessionStore.getState().setActiveTab("s1", "markdown");

      expect(useSessionStore.getState().getActiveTab("s1")).toBe("markdown");
    });

    it("tracks tabs independently per session", () => {
      useSessionStore.getState().setActiveTab("s1", "markdown");
      useSessionStore.getState().setActiveTab("s2", "diff");

      expect(useSessionStore.getState().getActiveTab("s1")).toBe("markdown");
      expect(useSessionStore.getState().getActiveTab("s2")).toBe("diff");
    });

    it("allows overwriting a previously set tab", () => {
      useSessionStore.getState().setActiveTab("s1", "markdown");
      useSessionStore.getState().setActiveTab("s1", "diff");

      expect(useSessionStore.getState().getActiveTab("s1")).toBe("diff");
    });

    it("returns 'terminal' for sessions that were never set even when others were", () => {
      useSessionStore.getState().setActiveTab("s1", "diff");

      expect(useSessionStore.getState().getActiveTab("s2")).toBe("terminal");
    });
  });

  // -------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------
  describe("createSession", () => {
    it("calls invoke with correct arguments", async () => {
      mockedInvoke.mockResolvedValueOnce(makeBackendSession({ id: "new-s" }));

      await useSessionStore.getState().createSession("p1", "build feature");

      expect(mockedInvoke).toHaveBeenCalledWith("create_session", {
        projectId: "p1",
        task: "build feature",
      });
    });

    it("adds the new session to the map", async () => {
      mockedInvoke.mockResolvedValueOnce(
        makeBackendSession({ id: "new-s", generated_name: "Feature Work" }),
      );

      await useSessionStore.getState().createSession("p1", "build feature");

      const session = useSessionStore.getState().sessions.get("new-s");
      expect(session).toBeDefined();
      expect(session!.generatedName).toBe("Feature Work");
      expect(session!.projectId).toBe("p1");
    });

    it("sets the new session as active", async () => {
      mockedInvoke.mockResolvedValueOnce(makeBackendSession({ id: "new-s" }));

      await useSessionStore.getState().createSession("p1", "task");

      expect(useSessionStore.getState().activeSessionId).toBe("new-s");
    });

    it("returns the new session ID", async () => {
      mockedInvoke.mockResolvedValueOnce(makeBackendSession({ id: "new-s" }));

      const id = await useSessionStore.getState().createSession("p1", "task");

      expect(id).toBe("new-s");
    });

    it("preserves existing sessions when creating a new one", async () => {
      seedSessions(makeSessionData({ id: "existing" }));
      mockedInvoke.mockResolvedValueOnce(makeBackendSession({ id: "new-s" }));

      await useSessionStore.getState().createSession("p1", "task");

      expect(useSessionStore.getState().sessions.has("existing")).toBe(true);
      expect(useSessionStore.getState().sessions.has("new-s")).toBe(true);
      expect(useSessionStore.getState().sessions.size).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // restartSession
  // -------------------------------------------------------------------
  describe("restartSession", () => {
    it("calls invoke with correct arguments", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      mockedInvoke.mockResolvedValueOnce(makeBackendSession({ id: "s1" }));

      await useSessionStore.getState().restartSession("s1");

      expect(mockedInvoke).toHaveBeenCalledWith("restart_session", { sessionId: "s1" });
    });

    it("replaces session data with the backend response", async () => {
      seedSessions(
        makeSessionData({ id: "s1", status: "exited", generatedName: "Old" }),
      );
      mockedInvoke.mockResolvedValueOnce(
        makeBackendSession({
          id: "s1",
          status: "running",
          generated_name: "Restarted",
        }),
      );

      await useSessionStore.getState().restartSession("s1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.status).toBe("running");
      expect(session.generatedName).toBe("Restarted");
    });

    it("sets the restarted session as active", async () => {
      seedSessions(makeSessionData({ id: "s1" }));
      useSessionStore.setState({ activeSessionId: null });
      mockedInvoke.mockResolvedValueOnce(makeBackendSession({ id: "s1" }));

      await useSessionStore.getState().restartSession("s1");

      expect(useSessionStore.getState().activeSessionId).toBe("s1");
    });

    it("does not modify sessions when invoke rejects", async () => {
      seedSessions(
        makeSessionData({ id: "s1", status: "exited", generatedName: "Original" }),
      );
      mockedInvoke.mockRejectedValueOnce(new Error("restart failed"));

      await useSessionStore.getState().restartSession("s1");

      const session = useSessionStore.getState().sessions.get("s1")!;
      expect(session.status).toBe("exited");
      expect(session.generatedName).toBe("Original");
    });
  });

  // -------------------------------------------------------------------
  // renameSession
  // -------------------------------------------------------------------
  describe("renameSession", () => {
    it("calls invoke and updates generatedName on success", async () => {
      seedSessions(makeSessionData({ id: "s1", generatedName: "Old" }));
      mockedInvoke.mockResolvedValueOnce(undefined);

      await useSessionStore.getState().renameSession("s1", "New Name");

      expect(mockedInvoke).toHaveBeenCalledWith("rename_session", {
        sessionId: "s1",
        name: "New Name",
      });
      expect(useSessionStore.getState().sessions.get("s1")!.generatedName).toBe(
        "New Name",
      );
    });

    it("does not update name when invoke rejects", async () => {
      seedSessions(makeSessionData({ id: "s1", generatedName: "Original" }));
      mockedInvoke.mockRejectedValueOnce(new Error("rename failed"));

      await useSessionStore.getState().renameSession("s1", "New Name");

      expect(useSessionStore.getState().sessions.get("s1")!.generatedName).toBe(
        "Original",
      );
    });
  });

  // -------------------------------------------------------------------
  // setActiveProject
  // -------------------------------------------------------------------
  describe("setActiveProject", () => {
    it("sets activeProjectId", () => {
      useSessionStore.getState().setActiveProject("p1");

      expect(useSessionStore.getState().activeProjectId).toBe("p1");
    });

    it("can set activeProjectId to null", () => {
      useSessionStore.setState({ activeProjectId: "p1" });

      useSessionStore.getState().setActiveProject(null);

      expect(useSessionStore.getState().activeProjectId).toBeNull();
    });
  });
});
