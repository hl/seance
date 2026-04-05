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
    mock.addProject({ path: "/test/project-alpha" });
    mock.addProject({ path: "/test/project-beta" });
    await mock.install(page);
    await page.goto("/");

    // Open project alpha and create a session
    await page.getByRole("heading", { name: "project-alpha" }).click();
    await expect(page.locator("header")).toContainText("project-alpha");
    await createSession(page, "alpha-task");
    await expect(page.getByText("alpha-task")).toBeVisible();

    // Go back to picker
    await page.locator('header button[title="Back to projects"]').click();
    await expect(
      page.getByRole("heading", { name: "project-alpha" }),
    ).toBeVisible();

    // Open project beta
    await page.getByRole("heading", { name: "project-beta" }).click();
    await expect(page.locator("header")).toContainText("project-beta");

    // Beta should have no sessions — alpha's session should NOT appear
    await expect(page.getByText("No sessions yet")).toBeVisible();
    await expect(page.getByText("alpha-task")).not.toBeVisible();

    // Create a beta session
    await createSession(page, "beta-task");
    await expect(page.getByText("beta-task")).toBeVisible();
    await expect(page.getByText("alpha-task")).not.toBeVisible();

    // Go back and re-enter alpha
    await page.locator('header button[title="Back to projects"]').click();
    await page.getByRole("heading", { name: "project-alpha" }).click();

    // Alpha should show its session, not beta's
    const panel = page.locator(".border-l");
    await expect(panel.getByText("alpha-task")).toBeVisible();
    await expect(page.getByText("beta-task")).not.toBeVisible();
  });
});
