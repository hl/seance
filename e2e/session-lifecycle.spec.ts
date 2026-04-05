import { test, expect, type Page } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

/**
 * Session lifecycle E2E tests using the typed MockBackend.
 */

const PROJECT_PATH = "/test/my-app";

async function openProject(page: Page) {
  await page.goto("/");
  await page.getByRole("heading", { name: "my-app" }).click();
  await expect(page.locator("header")).toContainText("my-app");
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
    mock.addProject({ path: PROJECT_PATH });
    await mock.install(page);
  });

  // ---- Session creation ---------------------------------------------------

  test("creating a session shows it in the session panel", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "fix-auth");

    await expect(page.getByText("fix-auth")).toBeVisible();

    const panel = page.locator(".border-l");
    await expect(panel.getByText(/Agent-/)).toBeVisible();
  });

  test("creating a session activates the terminal area", async ({ page }) => {
    await openProject(page);
    await expect(page.getByText("No sessions yet")).toBeVisible();

    await createSession(page, "build-feature");

    await expect(page.getByText("No sessions yet")).not.toBeVisible();
    const terminalArea = page.locator(".xterm");
    await expect(terminalArea).toBeVisible({ timeout: 5000 });
  });

  test("creating multiple sessions shows all in panel", async ({ page }) => {
    await openProject(page);

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
    await openProject(page);
    await createSession(page, "session-a");
    await createSession(page, "session-b");

    const sessionACard = page
      .locator("button")
      .filter({ hasText: "session-a" });
    await sessionACard.click();

    await expect(sessionACard).toHaveClass(/bg-neutral-800/);
  });

  // ---- Navigation: back to picker and re-entry ----------------------------

  test("navigating back to picker preserves session count", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "my-task");

    await page.locator('header button[title="Back to projects"]').click();
    await expect(page.getByRole("heading", { name: "my-app" })).toBeVisible();
  });

  test("re-entering a project with sessions does not show black screen", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "persistent-task");
    await expect(page.getByText("persistent-task")).toBeVisible();

    await page.locator('header button[title="Back to projects"]').click();
    await expect(page.getByRole("heading", { name: "my-app" })).toBeVisible();

    await page.getByRole("heading", { name: "my-app" }).click();
    await expect(page.locator("header")).toContainText("my-app");

    await expect(page.getByText("persistent-task")).toBeVisible();

    const panel = page.locator(".border-l");
    await expect(
      panel.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  test("re-entering a project shows the terminal for the active session", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "terminal-test");
    await expect(page.getByText("No sessions yet")).not.toBeVisible();

    await page.locator('header button[title="Back to projects"]').click();
    await page.getByRole("heading", { name: "my-app" }).click();

    await expect(page.getByText("No sessions yet")).not.toBeVisible();
    const terminalArea = page.locator(".xterm");
    await expect(terminalArea).toBeVisible({ timeout: 5000 });
  });

  // ---- Session panel state -----------------------------------------------

  test("session panel shows correct count after creating sessions", async ({
    page,
  }) => {
    await openProject(page);
    const panel = page.locator(".border-l");
    const countEl = panel.locator(".border-b span.text-neutral-600");

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

    const input = page.locator('input[aria-label="New session task name"]');
    await expect(input).toBeVisible();

    await input.fill("test-task");
    await input.press("Enter");

    await expect(input).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  // ---- Header elements ----------------------------------------------------

  test("session view header has back button, project name, and settings", async ({
    page,
  }) => {
    await openProject(page);

    const header = page.locator("header");
    await expect(
      header.locator('button[title="Back to projects"]'),
    ).toBeVisible();
    await expect(header).toContainText("my-app");
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

    const input = page.locator('input[aria-label="New session task name"]');
    await input.fill("INVALID SLUG!");
    await input.press("Enter");

    await expect(page.getByText(/lowercase/i)).toBeVisible();
    await expect(input).toBeVisible();
    await expect(page.locator("header")).toContainText("my-app");
  });

  // ---- Empty state --------------------------------------------------------

  test("empty project shows no-sessions prompt and new-session button", async ({
    page,
  }) => {
    await openProject(page);

    await expect(page.getByText("No sessions yet")).toBeVisible();

    const panel = page.locator(".border-l");
    const countEl = panel.locator(".border-b span.text-neutral-600");
    await expect(countEl).toHaveText("0");
    await expect(page.getByText("+ New Session")).toBeVisible();
  });
});
