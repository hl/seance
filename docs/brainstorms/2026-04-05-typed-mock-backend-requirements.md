---
date: 2026-04-05
topic: typed-mock-backend
---

# Typed Mock Backend for E2E Tests

## Problem Frame

Séance's Playwright E2E tests mock Tauri backend commands via `__TAURI_INTERNALS__` interception. The current approach has three problems: (1) mock response shapes are hand-crafted JS objects that can drift from the Rust backend's actual serialization — this caused the biggest production bug (missing `sessions` array in `list_projects`); (2) mock setup is scattered across files — static data in `mock-data.ts`, an 80-line inline stateful mock in `session-lifecycle.spec.ts`, and per-test `mockTauriCommand` calls; (3) there's no way to simulate async events (status changes, session exits) without wiring up custom `transformCallback` plumbing per test.

## Requirements

**Type Safety**

- R1. A single `e2e/types/backend.ts` file defines TypeScript types for all Tauri command request/response shapes, mirroring the Rust models. Each type has a comment linking to its Rust source file and struct name.
- R2. The MockBackend class uses these types for all return values and state — tests get type errors if they pass or expect wrong shapes.

**Stateful Mock Backend**

- R3. A `MockBackend` class tracks in-memory state: projects (Map), sessions (Map), and app settings.
- R4. `MockBackend` handles all 13 Tauri commands with correct behavior: `create_session` adds a session and returns it, `kill_session` marks as exited, `list_projects` returns current state with active session counts and session summaries, etc.
- R5. Tests create a MockBackend instance, optionally seed initial state (projects, sessions), and install it on the page via a single `mock.install(page)` call that sets up `__TAURI_INTERNALS__`.
- R6. The mock handles `plugin:event|listen` and `plugin:event|unlisten` commands for Tauri event registration.

**Event Simulation**

- R7. MockBackend exposes explicit methods to simulate Tauri events: `mock.emitSessionStatus(sessionId, status, message?)`, `mock.emitSessionExited(sessionId)`, `mock.emitSessionNameUpdated(sessionId, name)`.
- R8. Event emission invokes the registered `transformCallback` listeners on the page, so the frontend's `useSessionEvents` hook receives the events naturally.

**Migration**

- R9. Existing test files (`project-picker.spec.ts`, `session-view.spec.ts`, `session-lifecycle.spec.ts`) are migrated to use MockBackend, replacing `installTauriMocks`, `mockTauriCommand`, `MOCK_PROJECTS`, `MOCK_SETTINGS`, and the inline stateful mock.
- R10. After migration, `e2e/helpers/tauri-mock.ts` and `e2e/helpers/mock-data.ts` are deleted.

## Success Criteria

- All 20 existing Playwright tests pass using MockBackend instead of the old mock approach
- Adding a new Tauri command requires updating exactly one types file and one handler in MockBackend — not every test file that uses that command
- A contract mismatch (e.g., renaming a field in Rust) is caught by TypeScript compilation of the test code, not by a runtime failure in the app

## Scope Boundaries

- No auto-generation from Rust (manual types file — lightweight, no build step)
- No JSON Schema validation or CI contract checks
- No Channel streaming simulation (subscribe_output returns scrollback bytes; live streaming is a separate improvement)
- No visual regression or screenshot testing
- Does not change the Rust backend or frontend app code — only E2E test infrastructure

## Key Decisions

- **Manual types over codegen**: A single `backend.ts` types file with comments linking to Rust sources. Drift is caught by TypeScript compilation + E2E test failures. No build step, no Rust dev-dependency.
- **Explicit event emission over automatic**: `mock.emitSessionStatus()` gives tests precise control over when events fire, enabling deterministic status transition tests.
- **Single class over scattered helpers**: MockBackend replaces 3 separate mock mechanisms with one API surface.

## Dependencies / Assumptions

- The `__TAURI_INTERNALS__` interception approach continues to work in Tauri v2 (it's the standard testing pattern)
- Event emission requires `page.evaluate()` to invoke registered callbacks from the Playwright test context

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] How should `mock.install(page)` handle the `addInitScript` timing — should it serialize the MockBackend state into the init script, or use `page.evaluate` for dynamic state updates?
- [Affects R7][Technical] Can `page.evaluate` invoke `transformCallback`-registered listeners, or does event emission need to happen inside `addInitScript` scope?

## Next Steps

→ `/ce:plan` for structured implementation planning
