import { test, expect, type Page } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

/**
 * Navigate directly to a project window (simulates being in a dedicated
 * project window with URL params, since the picker no longer navigates
 * in-place).
 */
async function openProjectWindow(
  page: Page,
  projectId: string,
  projectName: string,
) {
  await page.goto(
    `/?projectId=${projectId}&projectName=${encodeURIComponent(projectName)}&projectPath=${encodeURIComponent("/test/" + projectName)}`,
  );
  // Session panel should be visible with the project name
  await expect(page.getByText(projectName)).toBeVisible();
}

async function createSession(page: Page, task: string) {
  await page.getByText("+ New Session").click();
  const input = page.locator('input[aria-label="New session task name"]');
  await input.fill(task);
  await input.press("Enter");
  await expect(input).not.toBeVisible({ timeout: 10000 });
  await expect(page.locator(".border-l").getByText(task)).toBeVisible();
}

test.describe("Session Actions", () => {
  let projectId: string;

  test.beforeEach(async ({ page }) => {
    const mock = new MockBackend();
    const project = mock.addProject({ path: "/test/my-app" });
    projectId = project.id;
    await mock.install(page);
  });

  test("kill session via context menu changes status to exited", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId, "my-app");
    await createSession(page, "to-kill");

    // Right-click the session card to open context menu
    const card = page.locator("button").filter({ hasText: "to-kill" });
    await card.click({ button: "right" });

    // Click "Kill" in the context menu
    const killItem = page.getByText("Kill", { exact: true });
    await expect(killItem).toBeVisible();
    await killItem.click();

    // Confirm the kill dialog (mock confirm returns true by default)
    // After killing, the card should still exist but the context menu
    // should now show Restart instead of Kill
    await card.click({ button: "right" });
    const restartItem = page.getByText("Restart", { exact: true });
    await expect(restartItem).toBeVisible({ timeout: 5000 });

    // Kill should no longer be in the context menu
    await expect(
      page.getByText("Kill", { exact: true }),
    ).not.toBeVisible();
  });

  test("restart session via context menu changes status back to running", async ({
    page,
  }) => {
    await openProjectWindow(page, projectId, "my-app");
    await createSession(page, "to-restart");

    // Kill first via context menu
    const card = page.locator("button").filter({ hasText: "to-restart" });
    await card.click({ button: "right" });
    await page.getByText("Kill", { exact: true }).click();

    // Now restart via context menu
    await card.click({ button: "right" });
    const restartItem = page.getByText("Restart", { exact: true });
    await expect(restartItem).toBeVisible({ timeout: 5000 });
    await restartItem.click();

    // Should be back to running — context menu should show Kill again
    await card.click({ button: "right" });
    await expect(
      page.getByText("Kill", { exact: true }),
    ).toBeVisible({ timeout: 5000 });
  });
});
