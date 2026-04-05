import { test, expect, type Page } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

async function openProject(page: Page) {
  await page.goto("/");
  await page.getByRole("heading", { name: "my-app" }).click();
  await expect(page.locator("header")).toContainText("my-app");
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
  test.beforeEach(async ({ page }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/my-app" });
    await mock.install(page);
  });

  test("kill session changes status to exited and shows restart button", async ({
    page,
  }) => {
    await openProject(page);
    await createSession(page, "to-kill");

    // Hover over the session card to reveal the kill button
    const card = page.locator("button").filter({ hasText: "to-kill" });
    await card.hover();

    // Click the kill button (✕)
    const killBtn = card.locator('[title="Kill session"]');
    await expect(killBtn).toBeVisible();
    await killBtn.click();

    // Status should change — the card should now show the restart button on hover
    await card.hover();
    const restartBtn = card.locator('[title="Restart session"]');
    await expect(restartBtn).toBeVisible({ timeout: 5000 });

    // Kill button should be gone
    await expect(killBtn).not.toBeVisible();
  });

  test("restart session changes status back to running", async ({ page }) => {
    await openProject(page);
    await createSession(page, "to-restart");

    // Kill first
    const card = page.locator("button").filter({ hasText: "to-restart" });
    await card.hover();
    await card.locator('[title="Kill session"]').click();

    // Now restart
    await card.hover();
    const restartBtn = card.locator('[title="Restart session"]');
    await expect(restartBtn).toBeVisible({ timeout: 5000 });
    await restartBtn.click();

    // Should be back to running — kill button visible, restart hidden
    await card.hover();
    await expect(card.locator('[title="Kill session"]')).toBeVisible({
      timeout: 5000,
    });
  });
});
