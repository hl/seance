import { test, expect, type Page } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

test.describe("Settings", () => {
  test("global settings save and persist values", async ({ page }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/my-app" });
    await mock.install(page);
    await page.goto("/");

    // Navigate to settings
    await page.locator('[title="App settings"]').click();
    await expect(page.locator("header")).toContainText("Settings");

    // Change hook port
    const portInput = page.locator("#hook-port");
    await portInput.fill("9999");

    // Change font size
    const fontInput = page.locator("#font-size");
    await fontInput.fill("18");

    // Save
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible({
      timeout: 5000,
    });

    // Navigate away and come back
    await page.locator('[title="Back to projects"]').click();
    await page.locator('[title="App settings"]').click();

    // Values should persist (mock's update_app_settings stores them)
    await expect(portInput).toHaveValue("9999");
    await expect(fontInput).toHaveValue("18");
  });

  test("project settings save command template", async ({ page }) => {
    const mock = new MockBackend();
    mock.addProject({
      path: "/test/my-app",
      command_template: "old-command",
    });
    await mock.install(page);
    await page.goto("/");

    // Navigate to project
    await page.getByRole("heading", { name: "my-app" }).click();
    await expect(page.locator("header")).toContainText("my-app");

    // Open project settings
    await page.locator('header [title="Project settings"]').click();
    await expect(
      page.getByText("Command Template", { exact: true }),
    ).toBeVisible();

    // Edit template
    const templateInput = page.locator("#command-template");
    await templateInput.fill("claude -w {{task}}");

    // Save
    await page.getByRole("button", { name: "Save" }).click();

    // Modal should close
    await expect(
      page.getByText("Command Template", { exact: true }),
    ).not.toBeVisible({ timeout: 5000 });
  });
});
