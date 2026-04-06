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

  test("clicking a project calls open_project_window (multi-window model)", async ({
    page,
  }) => {
    const mock = new MockBackend();
    mock.addProject({ path: "/test/my-app" });
    await mock.install(page);

    // Track open_project_window invocations
    await page.addInitScript(() => {
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__open_project_calls__ = [];
      (window as any).__TAURI_INTERNALS__.invoke = (
        cmd: string,
        args?: any,
      ) => {
        if (cmd === "open_project_window") {
          (window as any).__open_project_calls__.push(args);
          return Promise.resolve(null);
        }
        return orig(cmd, args);
      };
    });
    await page.goto("/");

    await page.getByRole("heading", { name: "my-app" }).click();

    // Verify open_project_window was called
    const calls = await page.evaluate(
      () => (window as any).__open_project_calls__,
    );
    expect(calls.length).toBe(1);
    expect(calls[0].projectName).toBe("my-app");

    // Picker should still be showing (not navigated away)
    await expect(
      page.getByRole("heading", { name: "my-app" }),
    ).toBeVisible();
  });

  test("Session View empty state shows Sessions header and new-session button", async ({
    page,
  }) => {
    const mock = new MockBackend();
    const project = mock.addProject({ path: "/test/another-project" });
    await mock.install(page);

    // Navigate directly to project window via URL params
    await page.goto(
      `/?projectId=${project.id}&projectName=another-project&projectPath=${encodeURIComponent("/test/another-project")}`,
    );

    await expect(
      page.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    await expect(page.getByText("+ New Session")).toBeVisible();
  });
});
