import type { Page } from "@playwright/test";
import type {
  AppSettings,
  Project,
  ProjectWithSessions,
  Session,
  SessionStatus,
  SessionSummary,
} from "../types/backend";

/**
 * Stateful mock backend for Playwright E2E tests.
 *
 * Replaces scattered static/inline mocks with a single type-safe class
 * that simulates Tauri backend behavior. Tracks projects, sessions, and
 * settings in memory. Commands mutate state so subsequent queries reflect
 * the change (e.g., create_session → list_projects includes the new session).
 *
 * Usage:
 *   const mock = new MockBackend();
 *   mock.addProject({ path: "/my/project", command_template: "claude -w {{task}}" });
 *   await mock.install(page);
 *   await page.goto("/");
 */

// --- Seed data helpers ---

let projectCounter = 0;
let sessionCounter = 0;

export function makeProject(overrides: Partial<Project> = {}): Project {
  projectCounter++;
  return {
    id: overrides.id ?? `project-${String(projectCounter).padStart(4, "0")}`,
    path: overrides.path ?? `/test/project-${projectCounter}`,
    command_template: overrides.command_template ?? "echo {{task}}",
    created_at: overrides.created_at ?? String(Math.floor(Date.now() / 1000)),
  };
}

export function makeSession(
  projectId: string,
  overrides: Partial<Session> = {},
): Session {
  sessionCounter++;
  const id =
    overrides.id ?? `session-${String(sessionCounter).padStart(4, "0")}`;
  return {
    id,
    project_id: projectId,
    task: overrides.task ?? `task-${sessionCounter}`,
    generated_name: overrides.generated_name ?? `Agent-${id.slice(0, 8)}`,
    status: overrides.status ?? "running",
    last_message: overrides.last_message ?? null,
    created_at:
      overrides.created_at ?? String(Math.floor(Date.now() / 1000)),
    last_started_at: overrides.last_started_at ?? null,
    last_known_pid: overrides.last_known_pid ?? null,
  };
}

// --- MockBackend class ---

export class MockBackend {
  projects: Map<string, Project> = new Map();
  sessions: Map<string, Session> = new Map();
  settings: AppSettings = {
    hook_port: 7837,
    terminal_font_size: 14,
    terminal_theme: "system",
  };

  // --- State seeding ---

  addProject(overrides: Partial<Project> = {}): Project {
    const project = makeProject(overrides);
    this.projects.set(project.id, project);
    return project;
  }

  addSession(projectId: string, overrides: Partial<Session> = {}): Session {
    const session = makeSession(projectId, overrides);
    this.sessions.set(session.id, session);
    return session;
  }

  // --- Install on Playwright page ---

  /**
   * Install the mock backend on a Playwright page via addInitScript.
   * Must be called BEFORE page.goto().
   */
  async install(page: Page): Promise<void> {
    // Serialize current state so addInitScript has it on first load
    const serializedState = {
      projects: Object.fromEntries(this.projects),
      sessions: Object.fromEntries(this.sessions),
      settings: { ...this.settings },
    };

    await page.addInitScript(
      (state: typeof serializedState) => {
        // Reconstruct Maps from serialized objects
        const projects = new Map<string, any>(Object.entries(state.projects));
        const sessions = new Map<string, any>(Object.entries(state.sessions));
        let settings = { ...state.settings };
        let callbackCounter = 0;
        const eventListeners = new Map<string, Set<number>>();

        function projectList() {
          const result: any[] = [];
          for (const p of projects.values()) {
            const projectSessions: any[] = [];
            let activeCount = 0;
            for (const s of sessions.values()) {
              if (s.project_id === p.id) {
                projectSessions.push({ id: s.id, status: s.status });
                if (s.status !== "exited" && s.status !== "done") {
                  activeCount++;
                }
              }
            }
            result.push({
              ...p,
              name: "",
              active_session_count: activeCount,
              sessions: projectSessions,
            });
          }
          result.sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
          return result;
        }

        (window as any).__TAURI_INTERNALS__ = {
          invoke(cmd: string, args?: any): Promise<unknown> {
            try {
              switch (cmd) {
                case "list_projects":
                  return Promise.resolve(projectList());

                case "list_sessions": {
                  const pid = args?.projectId as string;
                  const result: any[] = [];
                  for (const s of sessions.values()) {
                    if (s.project_id === pid) result.push({ ...s });
                  }
                  result.sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
                  return Promise.resolve(result);
                }

                case "add_project": {
                  const id = crypto.randomUUID();
                  const project = {
                    id,
                    path: args?.path ?? "/unknown",
                    command_template: "",
                    created_at: String(Math.floor(Date.now() / 1000)),
                  };
                  projects.set(id, project);
                  return Promise.resolve(project);
                }

                case "remove_project": {
                  const pid = args?.id;
                  projects.delete(pid);
                  for (const [sid, s] of sessions) {
                    if (s.project_id === pid) sessions.delete(sid);
                  }
                  return Promise.resolve(null);
                }

                case "update_project_settings": {
                  const p = projects.get(args?.id);
                  if (p && args?.settings?.command_template !== undefined) {
                    p.command_template = args.settings.command_template;
                  }
                  return Promise.resolve(null);
                }

                case "create_session": {
                  const id = crypto.randomUUID();
                  const session = {
                    id,
                    project_id: args?.projectId ?? "",
                    task: args?.task ?? "unknown",
                    generated_name: `Agent-${id.slice(0, 8)}`,
                    status: "running",
                    last_message: null,
                    created_at: String(Math.floor(Date.now() / 1000)),
                    last_started_at: String(Math.floor(Date.now() / 1000)),
                    last_known_pid: 12345,
                  };
                  sessions.set(id, session);
                  return Promise.resolve(session);
                }

                case "kill_session": {
                  const s = sessions.get(args?.sessionId);
                  if (s) s.status = "exited";
                  return Promise.resolve(null);
                }

                case "restart_session": {
                  const s = sessions.get(args?.sessionId);
                  if (s) {
                    s.status = "running";
                    s.last_message = null;
                    s.last_started_at = String(Math.floor(Date.now() / 1000));
                    return Promise.resolve({ ...s });
                  }
                  return Promise.reject("Session not found");
                }

                case "send_input":
                case "resize_pty":
                case "open_project_window":
                  return Promise.resolve(null);

                case "subscribe_output":
                  return Promise.resolve([]);

                case "get_scrollback":
                  return Promise.resolve([]);

                case "get_app_settings":
                  return Promise.resolve({ ...settings });

                case "update_app_settings":
                  if (args?.settings) settings = { ...args.settings };
                  return Promise.resolve(null);

                case "plugin:event|listen": {
                  const event = args?.event as string;
                  const handler = args?.handler as number;
                  if (event && handler !== undefined) {
                    if (!eventListeners.has(event)) {
                      eventListeners.set(event, new Set());
                    }
                    eventListeners.get(event)!.add(handler);
                  }
                  return Promise.resolve(callbackCounter++);
                }

                case "plugin:event|unlisten":
                  return Promise.resolve(null);

                default:
                  console.warn(`[MockBackend] un-mocked command: ${cmd}`, args);
                  return Promise.resolve(null);
              }
            } catch (e: any) {
              return Promise.reject(e.message ?? String(e));
            }
          },

          convertFileSrc(path: string): string {
            return path;
          },

          transformCallback(cb: (...a: any[]) => void, once = false): number {
            const id = callbackCounter++;
            (window as any)[`_${id}`] = (...a: any[]) => {
              cb(...a);
              if (once) delete (window as any)[`_${id}`];
            };
            return id;
          },

          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
        };

        // Expose event emission for tests
        (window as any).__MOCK_EMIT_EVENT__ = (
          event: string,
          payload: unknown,
        ) => {
          const listeners = eventListeners.get(event);
          if (listeners) {
            for (const handlerId of listeners) {
              const fn = (window as any)[`_${handlerId}`];
              if (fn) fn({ event, id: 0, payload });
            }
          }
        };
      },
      serializedState,
    );
  }

  // --- Event emission (called from test code via page.evaluate) ---

  /**
   * Emit a session-status event to the frontend.
   * Triggers registered listeners from useSessionEvents.
   */
  async emitSessionStatus(
    page: Page,
    sessionId: string,
    status: SessionStatus,
    message?: string,
  ): Promise<void> {
    await page.evaluate(
      ([event, payload]) => {
        (window as any).__MOCK_EMIT_EVENT__?.(event, payload);
      },
      [
        `session-status-${sessionId}`,
        { sessionId, status, last_message: message ?? null },
      ] as const,
    );
  }

  /**
   * Emit a session-exited event to the frontend.
   */
  async emitSessionExited(page: Page, sessionId: string): Promise<void> {
    await page.evaluate(
      ([event, payload]) => {
        (window as any).__MOCK_EMIT_EVENT__?.(event, payload);
      },
      [`session-exited-${sessionId}`, { sessionId }] as const,
    );
  }

  /**
   * Emit a session-name-updated event to the frontend.
   */
  async emitSessionNameUpdated(
    page: Page,
    sessionId: string,
    name: string,
  ): Promise<void> {
    await page.evaluate(
      ([event, payload]) => {
        (window as any).__MOCK_EMIT_EVENT__?.(event, payload);
      },
      [`session-name-updated-${sessionId}`, { sessionId, name }] as const,
    );
  }
}
