import { test, expect } from "@playwright/test";
import { installTauriMocks, mockTauriCommand } from "./helpers/tauri-mock";
import { MOCK_PROJECTS, MOCK_SETTINGS } from "./helpers/mock-data";

// ---------------------------------------------------------------------------
// Helper: navigate to the Session View for a given project.
// ---------------------------------------------------------------------------

async function navigateToSessionView(
  page: import("@playwright/test").Page,
  projectName: string,
) {
  await page.goto("/");
  // Click the project heading (not the path text, which also contains the name).
  await page.getByRole("heading", { name: projectName }).click();
  // Wait for the Session View header to confirm navigation completed.
  await expect(page.locator("header")).toContainText(projectName);
}

// ---------------------------------------------------------------------------
// Session View tests
// ---------------------------------------------------------------------------

test.describe("Session View", () => {
  test.beforeEach(async ({ page }) => {
    await installTauriMocks(page);
    await mockTauriCommand(page, "list_projects", MOCK_PROJECTS);
    await mockTauriCommand(page, "get_settings", MOCK_SETTINGS);
  });

  // -- Back button ----------------------------------------------------------

  test("back button returns to Project Picker", async ({ page }) => {
    await navigateToSessionView(page, "my-app");

    // Back button is the first button in the header (← arrow, title="Back to projects").
    await page.locator('header button[title="Back to projects"]').click();

    // We should be back at the picker — project headings reappear.
    await expect(
      page.getByRole("heading", { name: "my-app" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "another-project" }),
    ).toBeVisible();
  });

  // -- New Session input ----------------------------------------------------

  test("'+ New Session' click reveals input that validates slug format", async ({
    page,
  }) => {
    await navigateToSessionView(page, "my-app");

    const newSessionBtn = page.getByText("+ New Session");
    await newSessionBtn.click();

    // The input should now be visible.
    const input = page.locator("input[placeholder]").last();
    await expect(input).toBeVisible();

    // Type an invalid slug (uppercase, spaces).
    await input.fill("Bad Name!");
    await input.press("Enter");

    // Should still be showing input (creation failed due to validation).
    await expect(input).toBeVisible();
  });

  // -- Session cards --------------------------------------------------------

  test("session cards display after creating a session", async ({ page }) => {
    await navigateToSessionView(page, "my-app");

    // Create a session so there is a card to inspect.
    const newSessionBtn = page.getByText("+ New Session");
    await newSessionBtn.click();

    const input = page.locator("input[placeholder]").last();
    await input.fill("implement-api");
    await input.press("Enter");

    // The session card should contain the task name.
    await expect(page.getByText("implement-api")).toBeVisible();
  });

  // -- Settings button ------------------------------------------------------

  test("settings button opens project settings modal", async ({ page }) => {
    await navigateToSessionView(page, "my-app");

    // The settings button is the gear icon in the header (title="Project settings").
    await page.locator('header button[title="Project settings"]').click();

    // The modal should show the command template label.
    await expect(
      page.getByText("Command Template", { exact: true }),
    ).toBeVisible();
  });
});
