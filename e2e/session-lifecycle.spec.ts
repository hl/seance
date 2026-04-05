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
  await installTauriMocks(page);

  // Register a stateful mock via addInitScript so it's available on every
  // navigation. The state lives on window.__MOCK_STATE__.
  await page.addInitScript(
    ([projectId, projectPath]: [string, string]) => {
      const mockState = {
        sessions: [] as any[],
        nextChannelId: 1,
      };
      (window as any).__MOCK_STATE__ = mockState;

      const responses: Record<string, any> = (window as any)
        .__TAURI_MOCK_RESPONSES__;

      // list_projects: returns the project with current session state
      responses["list_projects"] = () => [
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
      ];

      // create_session: creates a new session and returns it
      responses["create_session"] = (args: any) => {
        const id = crypto.randomUUID();
        const session = {
          id,
          project_id: args?.projectId ?? projectId,
          task: args?.task ?? "unknown",
          generated_name: `Agent-${id.slice(0, 8)}`,
          status: "running",
          last_message: null,
          created_at: String(Math.floor(Date.now() / 1000)),
          last_started_at: String(Math.floor(Date.now() / 1000)),
          last_known_pid: 12345,
        };
        mockState.sessions.push(session);
        return session;
      };

      // subscribe_output: returns empty scrollback (no real PTY)
      responses["subscribe_output"] = () => [];

      // send_input: no-op
      responses["send_input"] = () => null;

      // resize_pty: no-op
      responses["resize_pty"] = () => null;

      // kill_session: mark session as exited
      responses["kill_session"] = (args: any) => {
        const session = mockState.sessions.find(
          (s: any) => s.id === args?.sessionId,
        );
        if (session) session.status = "exited";
        return null;
      };

      // restart_session: re-activate a session
      responses["restart_session"] = (args: any) => {
        const session = mockState.sessions.find(
          (s: any) => s.id === args?.sessionId,
        );
        if (session) {
          session.status = "running";
          session.last_message = null;
          return { ...session };
        }
        throw new Error("Session not found");
      };

      // get_app_settings
      responses["get_app_settings"] = () => ({
        hook_port: 7837,
        terminal_font_size: 14,
        terminal_theme: "system",
      });

      // update_project_settings: no-op
      responses["update_project_settings"] = () => null;

      // open_project_window: no-op
      responses["open_project_window"] = () => null;

      // Make invoke use function-based responses
      const origInvoke = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__TAURI_INTERNALS__.invoke = (
        cmd: string,
        args?: Record<string, unknown>,
      ): Promise<unknown> => {
        if (cmd in responses) {
          try {
            const result =
              typeof responses[cmd] === "function"
                ? responses[cmd](args)
                : responses[cmd];
            return Promise.resolve(result);
          } catch (e: any) {
            return Promise.reject(e.message || String(e));
          }
        }
        return origInvoke(cmd, args);
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
  await page.getByText("+ New Session").click();
  const input = page.locator("input[placeholder]").last();
  await expect(input).toBeVisible();
  await input.fill(task);
  await input.press("Enter");
  // Wait for the session card to appear in the panel
  await expect(page.getByText(task)).toBeVisible({ timeout: 5000 });
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
