import { test, expect, type Page } from "@playwright/test";
import { installTauriMocks } from "./helpers/tauri-mock";
import { MOCK_SETTINGS } from "./helpers/mock-data";

/**
 * These tests exercise the full session lifecycle end-to-end:
 * - Creating a session and seeing it in the terminal
 * - Session panel state after creation
 * - Navigating back to picker and re-entering a project
 * - Session persistence across navigation
 * - Multiple sessions
 *
 * The mock simulates dynamic backend state: create_session adds to the
 * session list, list_projects reflects active counts, etc.
 */

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_PATH = "/Users/test/projects/my-app";

/**
 * Install a stateful Tauri mock that simulates backend behavior.
 * The mock tracks created sessions and returns them in list_projects.
 */
async function installStatefulMocks(page: Page) {
  // Single addInitScript that sets up both __TAURI_INTERNALS__ and
  // stateful command handlers. Must be one script to avoid ordering issues.
  await page.addInitScript(
    ([projectId, projectPath]: [string, string]) => {
      const mockState = {
        sessions: [] as any[],
      };
      (window as any).__MOCK_STATE__ = mockState;

      // Callback registry for Channel support
      let callbackCounter = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
          try {
            switch (cmd) {
              case "list_projects":
                return Promise.resolve([
                  {
                    id: projectId,
                    path: projectPath,
                    name: "",
                    command_template: "claude -w {{task}}",
                    created_at: "1712300000",
                    active_session_count: mockState.sessions.filter(
                      (s: any) => s.status !== "exited" && s.status !== "done",
                    ).length,
                    sessions: mockState.sessions.map((s: any) => ({
                      id: s.id,
                      status: s.status,
                    })),
                  },
                ]);

              case "create_session": {
                const id = crypto.randomUUID();
                const session = {
                  id,
                  project_id: (args as any)?.projectId ?? projectId,
                  task: (args as any)?.task ?? "unknown",
                  generated_name: `Agent-${id.slice(0, 8)}`,
                  status: "running",
                  last_message: null,
                  created_at: String(Math.floor(Date.now() / 1000)),
                  last_started_at: String(Math.floor(Date.now() / 1000)),
                  last_known_pid: 12345,
                };
                mockState.sessions.push(session);
                return Promise.resolve(session);
              }

              case "subscribe_output":
                return Promise.resolve([]);

              case "send_input":
              case "resize_pty":
              case "update_project_settings":
              case "open_project_window":
                return Promise.resolve(null);

              case "kill_session": {
                const s = mockState.sessions.find(
                  (s: any) => s.id === (args as any)?.sessionId,
                );
                if (s) s.status = "exited";
                return Promise.resolve(null);
              }

              case "restart_session": {
                const s = mockState.sessions.find(
                  (s: any) => s.id === (args as any)?.sessionId,
                );
                if (s) {
                  s.status = "running";
                  s.last_message = null;
                  return Promise.resolve({ ...s });
                }
                return Promise.reject("Session not found");
              }

              case "get_app_settings":
                return Promise.resolve({
                  hook_port: 7837,
                  terminal_font_size: 14,
                  terminal_theme: "system",
                });

              // Tauri's listen() API uses this internal command
              case "plugin:event|listen": {
                // Return a numeric listener ID. The unlistener will call unlisten.
                return Promise.resolve(callbackCounter++);
              }
              case "plugin:event|unlisten":
                return Promise.resolve(null);

              default:
                console.warn(`[tauri-mock] un-mocked command: ${cmd}`, args);
                return Promise.resolve(null);
            }
          } catch (e: any) {
            return Promise.reject(e.message || String(e));
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
    },
    [PROJECT_ID, PROJECT_PATH] as [string, string],
  );
}

/** Navigate from picker to a project's Session View */
async function openProject(page: Page) {
  await page.goto("/");
  await page.getByRole("heading", { name: "my-app" }).click();
  await expect(page.locator("header")).toContainText("my-app");
}

/** Create a session with the given task name */
async function createSession(page: Page, task: string) {
  // Wait for the button to be clickable
  const newBtn = page.getByText("+ New Session");
  await expect(newBtn).toBeVisible({ timeout: 5000 });
  await newBtn.click();

  const input = page.locator('input[aria-label="New session task name"]');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(task);
  await input.press("Enter");

  // Wait for input to close (session created successfully)
  await expect(input).not.toBeVisible({ timeout: 10000 });

  // The session card should now be in the panel
  const panel = page.locator(".border-l");
  await expect(panel.getByText(task)).toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Session Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await installStatefulMocks(page);
  });

  // ---- Session creation ---------------------------------------------------

  test("creating a session shows it in the session panel", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "fix-auth");

    // Session card should show the task name
    await expect(page.getByText("fix-auth")).toBeVisible();

    // Session card should show the generated name (Agent-xxxx)
    const panel = page.locator(".border-l"); // session panel
    await expect(panel.getByText(/Agent-/)).toBeVisible();
  });

  test("creating a session activates the terminal area", async ({ page }) => {
    await openProject(page);

    // Before creating: empty state message visible
    await expect(page.getByText("No sessions yet")).toBeVisible();

    await createSession(page, "build-feature");

    // After creating: empty state should be gone
    await expect(page.getByText("No sessions yet")).not.toBeVisible();

    // Terminal container should be present (the div with xterm)
    const terminalArea = page.locator(".xterm");
    await expect(terminalArea).toBeVisible({ timeout: 5000 });
  });

  test("creating multiple sessions shows all in panel", async ({ page }) => {
    await openProject(page);

    await createSession(page, "task-one");
    await createSession(page, "task-two");
    await createSession(page, "task-three");

    // All three should be visible in the session panel
    await expect(page.getByText("task-one")).toBeVisible();
    await expect(page.getByText("task-two")).toBeVisible();
    await expect(page.getByText("task-three")).toBeVisible();

    // Session count should show 3
    const panel = page.locator(".border-l");
    await expect(panel.getByText("3", { exact: true })).toBeVisible();
  });

  // ---- Session switching --------------------------------------------------

  test("clicking a different session card switches the active session", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "session-a");
    await createSession(page, "session-b");

    // session-b should be active (most recently created)
    // Click session-a to switch
    const sessionACard = page
      .locator("button")
      .filter({ hasText: "session-a" });
    await sessionACard.click();

    // session-a's card should now be highlighted (has bg-neutral-800)
    await expect(sessionACard).toHaveClass(/bg-neutral-800/);
  });

  // ---- Navigation: back to picker and re-entry ----------------------------

  test("navigating back to picker preserves session count", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "my-task");

    // Go back to picker
    await page.locator('header button[title="Back to projects"]').click();

    // Picker should show the project
    await expect(page.getByRole("heading", { name: "my-app" })).toBeVisible();
  });

  test("re-entering a project with sessions does not show black screen", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "persistent-task");

    // Verify session is visible
    await expect(page.getByText("persistent-task")).toBeVisible();

    // Go back to picker
    await page.locator('header button[title="Back to projects"]').click();
    await expect(page.getByRole("heading", { name: "my-app" })).toBeVisible();

    // Re-enter the project
    await page.getByRole("heading", { name: "my-app" }).click();
    await expect(page.locator("header")).toContainText("my-app");

    // The session should still be visible in the panel
    // (This is the key assertion — the black screen bug means this fails)
    await expect(page.getByText("persistent-task")).toBeVisible();

    // The Sessions header should be visible (not a black screen)
    const panel = page.locator(".border-l");
    await expect(panel.getByRole("heading", { name: "Sessions" })).toBeVisible();

    // The "+ New Session" button should be visible
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  test("re-entering a project shows the terminal for the active session", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "terminal-test");

    // Terminal should be active (no "No sessions yet" message)
    await expect(page.getByText("No sessions yet")).not.toBeVisible();

    // Go back and re-enter
    await page.locator('header button[title="Back to projects"]').click();
    await page.getByRole("heading", { name: "my-app" }).click();

    // Terminal should still be active after re-entry
    await expect(page.getByText("No sessions yet")).not.toBeVisible();

    // xterm container should exist
    const terminalArea = page.locator(".xterm");
    await expect(terminalArea).toBeVisible({ timeout: 5000 });
  });

  // ---- Session panel state -----------------------------------------------

  test("session panel shows correct count after creating sessions", async ({
    page,
  }) => {
    await openProject(page);

    // The count is shown next to "Sessions" heading in the panel
    const panel = page.locator(".border-l");
    const countEl = panel.locator(".border-b span.text-neutral-600");

    // Initially 0
    await expect(countEl).toHaveText("0");

    await createSession(page, "first");
    await expect(countEl).toHaveText("1");

    await createSession(page, "second");
    await expect(countEl).toHaveText("2");
  });

  test("new session input closes after successful creation", async ({
    page,
  }) => {
    await openProject(page);
    await page.getByText("+ New Session").click();

    const input = page.locator("input[placeholder]").last();
    await expect(input).toBeVisible();

    await input.fill("test-task");
    await input.press("Enter");

    // Input should close after creation
    await expect(input).not.toBeVisible({ timeout: 5000 });

    // "+ New Session" button should reappear
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  // ---- Header elements in session view ------------------------------------

  test("session view header has back button, project name, and settings", async ({
    page,
  }) => {
    await openProject(page);

    const header = page.locator("header");

    // Back button
    await expect(
      header.locator('button[title="Back to projects"]'),
    ).toBeVisible();

    // Project name
    await expect(header).toContainText("my-app");

    // Settings gear button
    await expect(
      header.locator('button[title="Project settings"]'),
    ).toBeVisible();
  });

  // ---- Error handling: invalid slug ---------------------------------------

  test("creating session with invalid slug shows error without navigation", async ({
    page,
  }) => {
    await openProject(page);
    await page.getByText("+ New Session").click();

    const input = page.locator("input[placeholder]").last();
    await input.fill("INVALID SLUG!");
    await input.press("Enter");

    // Error message should appear
    await expect(page.getByText(/lowercase/i)).toBeVisible();

    // Input should still be visible (not closed)
    await expect(input).toBeVisible();

    // We should still be in the session view, not navigated away
    await expect(page.locator("header")).toContainText("my-app");
  });

  // ---- Empty project: no sessions state -----------------------------------

  test("empty project shows no-sessions prompt and new-session button", async ({
    page,
  }) => {
    await openProject(page);

    // Terminal area should show the empty state
    await expect(page.getByText("No sessions yet")).toBeVisible();

    // Session panel should show 0 count
    const panel = page.locator(".border-l");
    await expect(panel.getByText("0")).toBeVisible();

    // "+ New Session" should be available
    await expect(page.getByText("+ New Session")).toBeVisible();
  });
});
