import { test, expect } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

/**
 * Navigate directly to a project window via URL params.
 */
async function navigateToProjectWindow(
  page: import("@playwright/test").Page,
  projectId: string,
  projectName: string,
) {
  await page.goto(
    `/?projectId=${projectId}&projectName=${encodeURIComponent(projectName)}&projectPath=${encodeURIComponent("/test/" + projectName)}`,
  );
  await expect(page.getByText(projectName)).toBeVisible();
}

test.describe("Session View", () => {
  let projectId: string;

  test.beforeEach(async ({ page }) => {
    const mock = new MockBackend();
    const project = mock.addProject({ path: "/test/my-app" });
    projectId = project.id;
    mock.addProject({ path: "/test/another-project" });
    await mock.install(page);
  });

  test("session view has no header bar (multi-window model)", async ({
    page,
  }) => {
    await navigateToProjectWindow(page, projectId, "my-app");

    // No <header> element should exist in the session view
    await expect(page.locator("header")).not.toBeVisible();

    // Project name should appear in the session panel instead
    const panel = page.locator(".border-l");
    await expect(panel.getByText("my-app")).toBeVisible();
  });

  test("'+ New Session' click reveals input that auto-slugifies", async ({
    page,
  }) => {
    await navigateToProjectWindow(page, projectId, "my-app");
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

  test("settings button in panel opens project settings modal", async ({
    page,
  }) => {
    await navigateToProjectWindow(page, projectId, "my-app");

    // Settings gear is in the session panel, not a header
    const panel = page.locator(".border-l");
    await panel.locator('button[title="Project settings"]').click();
    await expect(
      page.getByText("Command Template", { exact: true }),
    ).toBeVisible();
  });
});
