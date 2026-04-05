import type { Page } from "@playwright/test";

/**
 * Injects a mock `window.__TAURI_INTERNALS__` object before any page code runs.
 *
 * This lets the frontend's `@tauri-apps/api/core` module (which delegates to
 * `__TAURI_INTERNALS__.invoke`) resolve commands against canned responses
 * without a running Tauri backend.
 *
 * Call this in `beforeEach` — it registers an `addInitScript` that fires on
 * every navigation/reload for the given Page.
 */
export async function installTauriMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Lookup table that tests populate via `mockTauriCommand`.
    (window as any).__TAURI_MOCK_RESPONSES__ =
      (window as any).__TAURI_MOCK_RESPONSES__ || {};

    // Callback registry used by `transformCallback` / `Channel`.
    let callbackCounter = 0;
    const callbacks: Record<number, (...args: any[]) => void> = {};

    (window as any).__TAURI_INTERNALS__ = {
      invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
        const responses = (window as any).__TAURI_MOCK_RESPONSES__ || {};

        // Support function-based mocks (serialised as "return ..." via
        // evaluate — not needed here because we always store plain data).
        if (cmd in responses) {
          return Promise.resolve(
            typeof responses[cmd] === "function"
              ? responses[cmd](args)
              : responses[cmd],
          );
        }

        // Default: resolve with null so the app doesn't crash on un-mocked
        // commands.
        console.warn(`[tauri-mock] un-mocked command: ${cmd}`, args);
        return Promise.resolve(null);
      },

      convertFileSrc(path: string): string {
        return path;
      },

      transformCallback(cb: (...args: any[]) => void, once = false): number {
        const id = callbackCounter++;
        callbacks[id] = (...args: any[]) => {
          cb(...args);
          if (once) delete callbacks[id];
        };
        // The Tauri JS runtime expects a numeric callback id.
        (window as any)[`_${id}`] = callbacks[id];
        return id;
      },

      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    };
  });
}

/**
 * Register a canned response for a Tauri `invoke` command.
 *
 * Must be called **before** the page navigates (i.e. before `page.goto`), or
 * you need to reload so that the init-script picks up the new value.
 *
 * For convenience you can also call it after `installTauriMocks` + before
 * `goto`, because `addInitScript` and `evaluate` both write to the same
 * `__TAURI_MOCK_RESPONSES__` object — but `evaluate` only affects the
 * *current* page context, so prefer `addInitScript`-based registration when
 * possible.
 */
export async function mockTauriCommand(
  page: Page,
  command: string,
  response: unknown,
): Promise<void> {
  // We use addInitScript so the value is available before any app code runs,
  // even on the first navigation.
  await page.addInitScript(
    ([cmd, resp]: [string, unknown]) => {
      (window as any).__TAURI_MOCK_RESPONSES__ =
        (window as any).__TAURI_MOCK_RESPONSES__ || {};
      (window as any).__TAURI_MOCK_RESPONSES__[cmd] = resp;
    },
    [command, response] as [string, unknown],
  );
}
