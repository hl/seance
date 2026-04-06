import { test, expect, type Page } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

async function createSession(page: Page, task: string) {
  await page.getByText("+ New Session").click();
  const input = page.locator('input[aria-label="New session task name"]');
  await input.fill(task);
  await input.press("Enter");
  await expect(input).not.toBeVisible({ timeout: 10000 });
  await expect(page.locator(".border-l").getByText(task)).toBeVisible();
}

test.describe("Multi-Project", () => {
  test("sessions are isolated per project", async ({ page }) => {
    const mock = new MockBackend();
    const alpha = mock.addProject({ path: "/test/project-alpha" });
    const beta = mock.addProject({ path: "/test/project-beta" });
    await mock.install(page);

    // Open project alpha window and create a session
    await page.goto(
      `/?projectId=${alpha.id}&projectName=project-alpha&projectPath=${encodeURIComponent("/test/project-alpha")}`,
    );
    await expect(page.getByText("project-alpha")).toBeVisible();
    await createSession(page, "alpha-task");
    await expect(page.getByText("alpha-task")).toBeVisible();

    // Navigate to project beta window (simulates opening a different window)
    await page.goto(
      `/?projectId=${beta.id}&projectName=project-beta&projectPath=${encodeURIComponent("/test/project-beta")}`,
    );
    await expect(page.getByText("project-beta")).toBeVisible();

    // Beta should have no sessions — alpha's session should NOT appear
    await expect(page.getByText("No sessions yet")).toBeVisible();
    await expect(page.getByText("alpha-task")).not.toBeVisible();

    // Create a beta session
    await createSession(page, "beta-task");
    await expect(page.getByText("beta-task")).toBeVisible();
    await expect(page.getByText("alpha-task")).not.toBeVisible();

    // Navigate back to project alpha window
    await page.goto(
      `/?projectId=${alpha.id}&projectName=project-alpha&projectPath=${encodeURIComponent("/test/project-alpha")}`,
    );

    // Alpha should show its session, not beta's
    const panel = page.locator(".border-l");
    await expect(panel.getByText("alpha-task")).toBeVisible();
    await expect(page.getByText("beta-task")).not.toBeVisible();
  });
});
