---
title: "Typed Mock Backend for Tauri v2 Playwright E2E Tests"
date: 2026-04-05
category: best-practices
module: e2e-testing
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - Writing Playwright E2E tests for a Tauri v2 desktop app
  - Hand-crafted mock response objects drift from the Rust backend's actual serialization
  - Multiple test files duplicate mock setup logic (static data, inline stateful mocks)
  - Frontend-backend contract mismatches cause production bugs that E2E tests should have caught
tags:
  - playwright
  - tauri-v2
  - e2e-testing
  - mock-backend
  - contract-testing
  - type-safety
---

# Typed Mock Backend for Tauri v2 Playwright E2E Tests

## Context

When testing a Tauri v2 app with Playwright, the real Rust backend doesn't run — Tauri APIs are mocked by intercepting `window.__TAURI_INTERNALS__`. The original approach used three separate mechanisms: static mock data (`mock-data.ts`), a helper that registers canned responses (`tauri-mock.ts`), and an 80-line inline stateful mock in `session-lifecycle.spec.ts`. These drifted from the backend's actual response shapes, causing the biggest production bug: the `list_projects` response was missing a `sessions` array that the frontend expected but the hand-crafted mock didn't include.

## Guidance

### 1. Single Types File Mirroring Rust Models

Create one `e2e/types/backend.ts` that defines TypeScript types for every Tauri command's request args and response shape, with comments linking to the Rust source:

```typescript
/** Mirrors: models::Session (src-tauri/src/models.rs) */
export interface Session {
  id: string;
  project_id: string;
  task: string;
  generated_name: string;
  status: SessionStatus;
  last_message: string | null;
  // ...
}
```

When a Rust struct changes, update this file — TypeScript compilation flags every mock and test that's out of sync.

### 2. Stateful MockBackend Class

Replace scattered mocks with a single `MockBackend` class that tracks state (projects, sessions, settings) and handles all Tauri commands with correct behavior:

```typescript
const mock = new MockBackend();
mock.addProject({ path: "/my/project", command_template: "claude -w {{task}}" });
await mock.install(page);
await page.goto("/");
```

The `install(page)` method serializes current state into an `addInitScript` that sets up `__TAURI_INTERNALS__` with a command router. Commands like `create_session` add to the session list; `list_projects` returns current state with computed active counts.

### 3. Event Emission for Async Assertions

Expose explicit methods for simulating Tauri events:

```typescript
await mock.emitSessionStatus(page, sessionId, "thinking", "Analyzing...");
await mock.emitSessionExited(page, sessionId);
```

These invoke `transformCallback`-registered listeners via `page.evaluate`, so the frontend's event hooks receive the events naturally.

## Why This Matters

- **Contract drift is structurally prevented**: Types are the single source of truth. A renamed field in Rust → update `backend.ts` → TypeScript flags every broken mock and assertion.
- **Test setup is 3 lines instead of 80**: `new MockBackend()` + `addProject()` + `install(page)` replaces inline state management, event listener registration, and command routing.
- **New commands are easy to add**: Add the type to `backend.ts`, add the handler to `MockBackend`, done. All existing tests continue to work.

## When to Apply

- Any Tauri v2 project using Playwright for E2E testing
- When mock response objects are hand-crafted rather than type-checked
- When multiple test files duplicate mock setup logic
- When a production bug was caused by mock/backend shape mismatch

## Examples

**Before (scattered mocks):**
```typescript
await installTauriMocks(page);
await mockTauriCommand(page, "list_projects", MOCK_PROJECTS);
await mockTauriCommand(page, "get_settings", MOCK_SETTINGS);
```

**After (typed MockBackend):**
```typescript
const mock = new MockBackend();
mock.addProject({ path: "/test/my-app" });
await mock.install(page);
```

See implementation: `e2e/helpers/mock-backend.ts`, `e2e/types/backend.ts`

## Related

- Origin: `docs/brainstorms/2026-04-05-typed-mock-backend-requirements.md`
- Related: `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md` (architecture patterns for the same app)
