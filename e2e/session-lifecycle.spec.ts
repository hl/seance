import { test, expect, type Page } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

/**
 * Session lifecycle E2E tests using the typed MockBackend.
 */

const PROJECT_PATH = "/test/my-app";

let projectId: string;

async function openProjectWindow(page: Page, id: string) {
  await page.goto(
    `/?projectId=${id}&projectName=my-app&projectPath=${encodeURIComponent(PROJECT_PATH)}`,
  );
  // Session panel should show the project name
  await expect(page.getByText("my-app")).toBeVisible();
}

async function createSession(page: Page, task: string) {
  const newBtn = page.getByText("+ New Session");
  await expect(newBtn).toBeVisible({ timeout: 5000 });
  await newBtn.click();

  const input = page.locator('input[aria-label="New session task name"]');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(task);
  await input.press("Enter");

  await expect(input).not.toBeVisible({ timeout: 10000 });

  const panel = page.locator(".border-l");
  await expect(panel.getByText(task)).toBeVisible({ timeout: 5000 });
}

test.describe("Session Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    const mock = new MockBackend();
    const project = mock.addProject({ path: PROJECT_PATH });
    projectId = project.id;
    await mock.install(page);
  });

  // ---- Session creation ---------------------------------------------------

  test("creating a session shows it in the session panel", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);
    await createSession(page, "fix-auth");

    await expect(page.getByText("fix-auth")).toBeVisible();

    const panel = page.locator(".border-l");
    await expect(panel.getByText(/Agent-/)).toBeVisible();
  });

  test("creating a session activates the terminal area", async ({ page }) => {
    await openProjectWindow(page, projectId);
    await expect(page.getByText("No sessions yet")).toBeVisible();

    await createSession(page, "build-feature");

    await expect(page.getByText("No sessions yet")).not.toBeVisible();
    const terminalArea = page.locator(".xterm");
    await expect(terminalArea).toBeVisible({ timeout: 5000 });
  });

  test("creating multiple sessions shows all in panel", async ({ page }) => {
    await openProjectWindow(page, projectId);

    await createSession(page, "task-one");
    await createSession(page, "task-two");
    await createSession(page, "task-three");

    await expect(page.getByText("task-one")).toBeVisible();
    await expect(page.getByText("task-two")).toBeVisible();
    await expect(page.getByText("task-three")).toBeVisible();

    const panel = page.locator(".border-l");
    await expect(panel.getByText("3", { exact: true })).toBeVisible();
  });

  // ---- Session switching --------------------------------------------------

  test("clicking a different session card switches the active session", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);
    await createSession(page, "session-a");
    await createSession(page, "session-b");

    const sessionACard = page
      .locator("button")
      .filter({ hasText: "session-a" });
    await sessionACard.click();

    await expect(sessionACard).toHaveClass(/bg-surface-active/);
  });

  // ---- Session panel state -----------------------------------------------

  test("session panel shows correct count after creating sessions", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);
    const panel = page.locator(".border-l");

    await createSession(page, "first");
    await expect(panel.getByText("1", { exact: true })).toBeVisible();

    await createSession(page, "second");
    await expect(panel.getByText("2", { exact: true })).toBeVisible();
  });

  test("new session input closes after successful creation", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);
    await page.getByText("+ New Session").click();

    const input = page.locator('input[aria-label="New session task name"]');
    await expect(input).toBeVisible();

    await input.fill("test-task");
    await input.press("Enter");

    await expect(input).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  // ---- Session view layout -----------------------------------------------

  test("session view has project name and settings in panel, no header", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);

    // No <header> element
    await expect(page.locator("header")).not.toBeVisible();

    // Project name and settings gear are in the session panel
    const panel = page.locator(".border-l");
    await expect(panel.getByText("my-app")).toBeVisible();
    await expect(
      panel.locator('button[title="Project settings"]'),
    ).toBeVisible();
  });

  // ---- Error handling: invalid slug ---------------------------------------

  test("input auto-slugifies text and creates session", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);
    await page.getByText("+ New Session").click();

    const input = page.locator('input[aria-label="New session task name"]');
    await input.fill("Fix Auth Bug!!");
    await input.press("Enter");

    // Should auto-slugify to "fix-auth-bug" and create the session
    await expect(input).not.toBeVisible({ timeout: 10000 });
    const panel = page.locator(".border-l");
    await expect(panel.getByText("fix-auth-bug")).toBeVisible();
  });

  // ---- Empty state --------------------------------------------------------

  test("empty project shows no-sessions prompt and new-session button", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId);

    await expect(page.getByText("No sessions yet")).toBeVisible();
    await expect(page.getByText("+ New Session")).toBeVisible();
  });
});
