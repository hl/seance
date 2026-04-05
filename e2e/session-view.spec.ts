import { test, expect } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

async function navigateToSessionView(
  page: import("@playwright/test").Page,
  projectName: string,
) {
  await page.goto("/");
  await page.getByRole("heading", { name: projectName }).click();
  await expect(page.locator("header")).toContainText(projectName);
}

test.describe("Session View", () => {
  test.beforeEach(async ({ page }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/my-app" });
    mock.addProject({ path: "/test/another-project" });
    await mock.install(page);
  });

  test("back button returns to Project Picker", async ({ page }) => {
    await navigateToSessionView(page, "my-app");
    await page.locator('header button[title="Back to projects"]').click();

    await expect(
      page.getByRole("heading", { name: "my-app" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "another-project" }),
    ).toBeVisible();
  });

  test("'+ New Session' click reveals input that auto-slugifies", async ({
    page,
  }) => {
    await navigateToSessionView(page, "my-app");
    await page.getByText("+ New Session").click();

    const input = page.locator("input[placeholder]").last();
    await expect(input).toBeVisible();

    // Input with spaces and uppercase is accepted and auto-slugified
    await input.fill("My Cool Task");
    await input.press("Enter");

    // Should create the session (input closes, card appears)
    await expect(input).not.toBeVisible({ timeout: 10000 });
    const panel = page.locator(".border-l");
    await expect(panel.getByText("my-cool-task")).toBeVisible();
  });

  // Session card creation is covered in session-lifecycle.spec.ts

  test("settings button opens project settings modal", async ({ page }) => {
    await navigateToSessionView(page, "my-app");
    await page.locator('header button[title="Project settings"]').click();
    await expect(
      page.getByText("Command Template", { exact: true }),
    ).toBeVisible();
  });
});
