---
title: "Tauri Frontend-Backend Field Naming Mismatches"
date: 2026-04-05
category: integration-issues
module: tauri-ipc
problem_type: integration_issue
component: tooling
symptoms:
  - "Black screen when opening a project (list_projects missing sessions array)"
  - "Settings page shows default values instead of saved values"
  - "Hook server status updates never reach the frontend"
  - "Project settings save fails: missing field command_template"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - tauri-v2
  - serde
  - camel-case
  - snake-case
  - ipc-contract
  - field-naming
---

# Tauri Frontend-Backend Field Naming Mismatches

## Problem

Multiple silent failures across Séance caused by the Rust backend serializing fields in snake_case while the TypeScript frontend expected camelCase (or vice versa). Tauri v2's IPC does NOT auto-convert between naming conventions — the JSON passes through verbatim.

## Symptoms

- **Black screen on project open**: `list_projects` response was missing a `sessions` array the frontend expected. Frontend called `project.sessions.map(...)` on undefined, crashing React.
- **Settings showed defaults**: `get_app_settings` returned `{ hook_port, terminal_font_size }` but the Settings component read `hookServerPort`, `terminalFontSize` — both undefined.
- **Status updates lost**: Hook server emitted events with `session_id` (snake_case) but `useSessionEvents` destructured `event.payload.sessionId` (camelCase) — always undefined.
- **Save failed**: `update_project_settings` expected `{ command_template }` but frontend sent `{ commandTemplate }`.

## What Didn't Work

- Assuming Tauri auto-converts between camelCase and snake_case (it doesn't — unlike some REST frameworks)
- Hand-crafting E2E mock data to match frontend expectations (masks the real contract, doesn't catch drift)

## Solution

**Rule: match the Rust serialization format exactly in TypeScript.**

For most fields, use snake_case in the frontend to match Rust's default serde behavior:

```typescript
// Before (broken)
interface AppSettings {
  hookServerPort: number;
  terminalFontSize: number;
}

// After (works)
interface AppSettings {
  hook_port: number;
  terminal_font_size: number;
}
```

For event payloads where the frontend expects camelCase, add `#[serde(rename_all = "camelCase")]` on the Rust struct:

```rust
// Before (emits session_id, frontend expects sessionId)
#[derive(Serialize)]
struct SessionStatusEvent {
    session_id: Uuid,
    status: SessionStatus,
    last_message: Option<String>,
}

// After (emits sessionId, matching frontend)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatusEvent {
    session_id: Uuid,
    status: SessionStatus,
    last_message: Option<String>,
}
```

For command arguments, use snake_case in `invoke()`:

```typescript
// Before (broken)
await invoke("update_project_settings", {
  id: projectId,
  settings: { commandTemplate },  // ← camelCase, backend rejects
});

// After (works)
await invoke("update_project_settings", {
  id: projectId,
  settings: { command_template: commandTemplate },  // ← snake_case
});
```

## Why This Works

Tauri v2's IPC serializes command arguments and return values through serde JSON. Rust's default serde serialization uses the struct field names verbatim (snake_case). The frontend receives raw JSON — no naming convention transformation. Every field name in `invoke()` arguments and response destructuring must match the Rust serde output exactly.

## Prevention

1. **Single types file**: Maintain `e2e/types/backend.ts` with TypeScript interfaces mirroring every Rust struct. Comment each type with its Rust source. Update this file when Rust changes.

2. **Typed MockBackend**: Use `MockBackend` class (see `e2e/helpers/mock-backend.ts`) that returns typed responses. TypeScript catches shape mismatches at compile time.

3. **Explicit serde annotations**: When a Rust struct is serialized for frontend consumption and you want camelCase, always add `#[serde(rename_all = "camelCase")]` explicitly. Don't rely on implicit behavior.

4. **E2E tests that exercise the full invoke chain**: Static mocks that return hand-crafted objects mask contract bugs. Use stateful mocks that simulate backend behavior so the response shapes are authoritative.

## Related Issues

- `docs/solutions/best-practices/typed-mock-backend-for-tauri-e2e-tests-2026-04-05.md` — the testing pattern that prevents this class of bug
- `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md` — architecture patterns for the same app
