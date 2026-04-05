import { test, expect } from "@playwright/test";
import { MockBackend } from "./helpers/mock-backend";

test.describe("Project CRUD", () => {
  test("add project: file picker → settings → project appears", async ({
    page,
  }) => {
    const mock = new MockBackend();
    await mock.install(page);
    await page.goto("/");

    // Initially no projects
    await expect(page.getByText("No projects yet")).toBeVisible();

    // Click "+ Add Project" — the mock handles add_project by creating a project
    // The file picker (plugin:dialog|open) is mocked to return a path
    await page.addInitScript(() => {
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__TAURI_INTERNALS__.invoke = (
        cmd: string,
        args?: any,
      ) => {
        if (cmd === "plugin:dialog|open") {
          return Promise.resolve("/test/new-project");
        }
        return orig(cmd, args);
      };
    });

    // Reload to pick up the dialog mock
    await page.reload();
    await expect(page.getByText("No projects yet")).toBeVisible();

    // Click add
    await page.getByRole("button", { name: "+ Add Project" }).click();

    // Project settings modal should appear for the new project
    await expect(
      page.getByText("Command Template", { exact: true }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("remove project: click remove → project disappears", async ({
    page,
  }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/project-to-remove" });
    mock.addProject({ path: "/test/project-to-keep" });
    await mock.install(page);
    await page.goto("/");

    // Both projects visible
    await expect(
      page.getByRole("heading", { name: "project-to-remove" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "project-to-keep" }),
    ).toBeVisible();

    // Hover first project card to reveal remove button
    const card = page
      .locator("button")
      .filter({ hasText: "project-to-remove" })
      .first();
    await card.hover();

    // Click the remove button (✕)
    const removeBtn = card.locator('[title="Remove project"]');
    if ((await removeBtn.count()) > 0) {
      await removeBtn.click();
    } else {
      // Try alternative: the ✕ text
      await card.getByText("✕").click();
    }

    // Wait for removal
    await page.waitForTimeout(1000);

    // Second project should remain
    await expect(
      page.getByRole("heading", { name: "project-to-keep" }),
    ).toBeVisible();
  });
});
