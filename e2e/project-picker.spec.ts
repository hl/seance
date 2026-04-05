import { test, expect } from "@playwright/test";
import { installTauriMocks, mockTauriCommand } from "./helpers/tauri-mock";
import { MOCK_PROJECTS, MOCK_SETTINGS } from "./helpers/mock-data";

// ---------------------------------------------------------------------------
// Project Picker — the default (landing) view of the app
// ---------------------------------------------------------------------------

test.describe("Project Picker", () => {
  // -- Empty state ----------------------------------------------------------

  test("shows empty state with no-projects message and add button", async ({
    page,
  }) => {
    await installTauriMocks(page);
    await mockTauriCommand(page, "list_projects", []);
    await mockTauriCommand(page, "get_settings", MOCK_SETTINGS);

    await page.goto("/");

    // The "+ Add Project" button should be visible.
    await expect(
      page.getByRole("button", { name: "+ Add Project" }),
    ).toBeVisible();

    // Empty-state hint text.
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  // -- Projects listed ------------------------------------------------------

  test("lists projects with names derived from their paths", async ({
    page,
  }) => {
    await installTauriMocks(page);
    await mockTauriCommand(page, "list_projects", MOCK_PROJECTS);
    await mockTauriCommand(page, "get_settings", MOCK_SETTINGS);

    await page.goto("/");

    // Project names are the last segment of the path — visible as headings.
    await expect(page.getByRole("heading", { name: "my-app" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "another-project" }),
    ).toBeVisible();

    // Paths should appear on the cards.
    await expect(
      page.getByText("/Users/test/projects/my-app"),
    ).toBeVisible();
    await expect(
      page.getByText("/Users/test/projects/another-project"),
    ).toBeVisible();
  });

  // -- Navigation to Session View -------------------------------------------

  test("clicking a project navigates to Session View", async ({ page }) => {
    await installTauriMocks(page);
    await mockTauriCommand(page, "list_projects", MOCK_PROJECTS);
    await mockTauriCommand(page, "get_settings", MOCK_SETTINGS);

    await page.goto("/");

    // Click the first project card by targeting the heading.
    await page.getByRole("heading", { name: "my-app" }).click();

    // Session View header should show the project name.
    await expect(page.locator("header")).toContainText("my-app");

    // Back button (← arrow) should be present.
    await expect(page.locator("header button").first()).toBeVisible();

    // Session panel should show "+ New Session" button.
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  // -- Session View empty state ---------------------------------------------

  test("Session View empty state shows Sessions header and new-session button", async ({
    page,
  }) => {
    await installTauriMocks(page);
    await mockTauriCommand(page, "list_projects", MOCK_PROJECTS);
    await mockTauriCommand(page, "get_settings", MOCK_SETTINGS);

    await page.goto("/");

    // Navigate to the second project (0 sessions).
    await page.getByRole("heading", { name: "another-project" }).click();

    // The session panel header reads "Sessions".
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

    // "+ New Session" is available.
    await expect(page.getByText("+ New Session")).toBeVisible();
  });
});
