import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// ---- Tauri event mock ----
// Each call to `listen` resolves with an unlisten spy.
// We capture the callback so tests can simulate incoming events.
type EventCallback = (event: { payload: unknown }) => void;

const listenCalls: Array<{
  eventName: string;
  callback: EventCallback;
  unlisten: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, callback: EventCallback) => {
    const unlisten = vi.fn();
    listenCalls.push({ eventName, callback, unlisten });
    return Promise.resolve(unlisten);
  }),
}));

// ---- Session store mock ----
// We need a controllable `sessions` Map that the hook reads via
// `useSessionStore((s) => s.sessions)`, plus spied store actions.
const updateStatusSpy = vi.fn();
const updateWorkingDirSpy = vi.fn();

// Minimal session factory
function makeSession(id: string, projectId: string) {
  return {
    id,
    projectId,
    task: "test",
    generatedName: "test",
    status: "running" as const,
    lastMessage: "",
    createdAt: Date.now(),
    lastStartedAt: null,
    exitedAt: null,
    exitCode: null,
    workingDir: "/tmp",
    baseCommit: null,
  };
}

// We hold a mutable sessions map that the store mock reads from.
let sessionsMap = new Map<string, ReturnType<typeof makeSession>>();

vi.mock("../../stores/sessionStore", () => {
  // Zustand selector-style: the hook calls useSessionStore(selector).
  // We simulate this by invoking the selector against our mock state.
  const useSessionStore = (selector: (state: { sessions: typeof sessionsMap }) => unknown) =>
    selector({ sessions: sessionsMap });

  // getState() is called inside event callbacks
  useSessionStore.getState = () => ({
    updateStatus: updateStatusSpy,
    updateWorkingDir: updateWorkingDirSpy,
    sessions: sessionsMap,
  });

  return { useSessionStore };
});

// Import hook AFTER mocks
import { useProjectSessionEvents } from "../useSessionEvents";

// ---- Helpers ----

/** Flush the microtask queue so listen Promises resolve. */
async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---- Tests ----

describe("useProjectSessionEvents", () => {
  beforeEach(() => {
    sessionsMap = new Map();
    listenCalls.length = 0;
    updateStatusSpy.mockClear();
    updateWorkingDirSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("subscribes to 3 events per session belonging to the project", async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));
    sessionsMap.set("s2", makeSession("s2", "proj-a"));

    renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    // 2 sessions x 3 events = 6 listen calls
    expect(listenCalls).toHaveLength(6);

    const eventNames = listenCalls.map((c) => c.eventName).sort();
    expect(eventNames).toEqual([
      "session-exited-s1",
      "session-exited-s2",
      "session-status-s1",
      "session-status-s2",
      "session-working-dir-s1",
      "session-working-dir-s2",
    ]);
  });

  it("does not subscribe for sessions belonging to other projects", async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));
    sessionsMap.set("s2", makeSession("s2", "proj-b"));

    renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    // Only s1 should get listeners
    expect(listenCalls).toHaveLength(3);
    for (const call of listenCalls) {
      expect(call.eventName).toContain("s1");
    }
  });

  it("calls unlisten when a session is removed", async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));
    sessionsMap.set("s2", makeSession("s2", "proj-a"));

    const { rerender } = renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    // Capture the unlisten fns for s2 before removing it
    const s2Unlistens = listenCalls
      .filter((c) => c.eventName.includes("s2"))
      .map((c) => c.unlisten);
    expect(s2Unlistens).toHaveLength(3);

    // Remove s2 from the store and rerender
    sessionsMap = new Map(sessionsMap);
    sessionsMap.delete("s2");
    rerender();
    await flushPromises();

    for (const fn of s2Unlistens) {
      expect(fn).toHaveBeenCalledOnce();
    }

    // s1 should still be subscribed (unlistens NOT called)
    const s1Unlistens = listenCalls
      .filter((c) => c.eventName.includes("s1"))
      .map((c) => c.unlisten);
    for (const fn of s1Unlistens) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("cleans up all listeners on unmount", async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));

    const { unmount } = renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    expect(listenCalls).toHaveLength(3);

    unmount();

    for (const call of listenCalls) {
      expect(call.unlisten).toHaveBeenCalledOnce();
    }
  });

  it("status event triggers updateStatus on the store", async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));

    renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    const statusCall = listenCalls.find(
      (c) => c.eventName === "session-status-s1",
    )!;

    act(() => {
      statusCall.callback({
        payload: {
          sessionId: "s1",
          status: "thinking",
          lastMessage: "Working on it",
        },
      });
    });

    expect(updateStatusSpy).toHaveBeenCalledOnce();
    expect(updateStatusSpy).toHaveBeenCalledWith(
      "s1",
      "thinking",
      "Working on it",
    );
  });

  it('exited event triggers updateStatus with "exited" and parsed exitedAt', async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));

    renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    const exitedCall = listenCalls.find(
      (c) => c.eventName === "session-exited-s1",
    )!;

    act(() => {
      exitedCall.callback({
        payload: {
          sessionId: "s1",
          exitCode: 0,
          exitedAt: "1700000000",
        },
      });
    });

    expect(updateStatusSpy).toHaveBeenCalledOnce();
    expect(updateStatusSpy).toHaveBeenCalledWith(
      "s1",
      "exited",
      undefined,
      0,
      1700000000000, // parsed: parseInt * 1000
    );
  });

  it("working dir event triggers updateWorkingDir on the store", async () => {
    sessionsMap.set("s1", makeSession("s1", "proj-a"));

    renderHook(() => useProjectSessionEvents("proj-a"));
    await flushPromises();

    const wdCall = listenCalls.find(
      (c) => c.eventName === "session-working-dir-s1",
    )!;

    act(() => {
      wdCall.callback({
        payload: {
          sessionId: "s1",
          workingDir: "/home/user/project",
          baseCommit: "abc123",
        },
      });
    });

    expect(updateWorkingDirSpy).toHaveBeenCalledOnce();
    expect(updateWorkingDirSpy).toHaveBeenCalledWith(
      "s1",
      "/home/user/project",
      "abc123",
    );
  });
});
