import { test, expect } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

test.describe("Project Picker", () => {
  test("shows empty state with no-projects message and add button", async ({
    page,
  }) => {
    const mock = new MockBackend();
    await mock.install(page);
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: "+ Add Project" }),
    ).toBeVisible();
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  test("lists projects with names derived from their paths", async ({
    page,
  }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/Users/test/projects/my-app" });
    mock.addProject({ path: "/Users/test/projects/another-project" });
    await mock.install(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "my-app" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "another-project" }),
    ).toBeVisible();
    await expect(
      page.getByText("/Users/test/projects/my-app"),
    ).toBeVisible();
  });

  test("clicking a project navigates to Session View", async ({ page }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/my-app" });
    await mock.install(page);
    await page.goto("/");

    await page.getByRole("heading", { name: "my-app" }).click();

    await expect(page.locator("header")).toContainText("my-app");
    await expect(page.locator("header button").first()).toBeVisible();
    await expect(page.getByText("+ New Session")).toBeVisible();
  });

  test("Session View empty state shows Sessions header and new-session button", async ({
    page,
  }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/another-project" });
    await mock.install(page);
    await page.goto("/");

    await page
      .getByRole("heading", { name: "another-project" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    await expect(page.getByText("+ New Session")).toBeVisible();
  });
});
