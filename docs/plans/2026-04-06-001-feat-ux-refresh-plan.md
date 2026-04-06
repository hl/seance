---
title: "feat: UX refresh — multi-window, session info density, naming, context menu"
type: feat
status: active
date: 2026-04-06
origin: docs/brainstorms/2026-04-06-ux-refresh-requirements.md
deepened: 2026-04-06
---

# feat: UX refresh — multi-window, session info density, naming, context menu

## Overview

Refine the Séance UX across four areas: (1) always-new-window navigation with the picker as a persistent hub, (2) information-dense session cards with elapsed time, created-at, exit code, and last message on all cards, (3) simplified `Agent-<hash>` naming with rename support, (4) context menu replacing hover buttons. Also removes the Session View header bar and fixes visual inconsistencies (straight corners).

## Problem Frame

The current UI has a hybrid navigation model that's harder to reason about than it needs to be, session cards that hide useful state, an external dependency on Claude CLI for name generation, and visual inconsistencies. See [origin document](docs/brainstorms/2026-04-06-ux-refresh-requirements.md) for full context.

## Requirements Trace

- R1. Project selection opens dedicated window (focus if already open)
- R2. Adding a project opens a new window after settings configured
- R3. Picker stays open as persistent hub
- R4. Remove Session View header bar
- R5. Project name + settings gear at top of right panel
- R6. Terminal takes full window height
- R7. Straight corners on session cards
- R8. Compact 3-line card layout (name+status+elapsed / task+created-at / last message)
- R9. All cards show last status message
- R10. Live elapsed time, measured from `last_started_at`
- R11. Created-at timestamp on cards
- R12. Non-zero exit code in red, exit 0 not shown
- R13. `Agent-<4chars>` default naming, preserve existing Haiku names
- R14. Double-click inline rename (blur/empty reverts)
- R15. Context menu (Rename, Kill with confirm, Restart, Delete) replaces hover buttons
- R16. Display name persisted across restarts
- R17. Prominent "+ New Session" button

## Scope Boundaries

- No changes to terminal behavior, PTY management, scrollback, or hook server
- No changes to project settings or command template UX
- Session avatars remain UUID-derived (unchanged)
- No window state restoration across app restarts
- No drag-to-reorder, search, or session export

## Context & Research

### Relevant Code and Patterns

| Area | Files | Notes |
|------|-------|-------|
| Multi-window | `src-tauri/src/commands/windows.rs`, `src/stores/appStore.ts`, `src/App.tsx` | `open_project_window` already handles focus-if-exists via Tauri window labels (`project-{id}`) |
| Session cards | `src/components/SessionCard.tsx`, `SessionPanel.tsx` | Hover actions use `group`/`group-hover:inline-block` pattern |
| Agent naming | `src-tauri/src/identity.rs`, `src-tauri/src/commands/sessions.rs:60-72` | Claude CLI call + background retry. Placeholder is `Agent-{8chars}` |
| Session model | `src-tauri/src/models.rs` (Session struct), `src/stores/sessionStore.ts` (SessionData) | `last_started_at` exists in Rust but dropped by `backendToFrontend`. No `exit_code` field yet |
| Exit watcher | `src-tauri/src/commands/sessions.rs:360-411` | `child.wait()` result is discarded as `_exit_status` |
| Event system | `src/hooks/useSessionEvents.ts` | Per-session listeners for status, exit, name-updated events |
| Styling | `src/index.css` | Semantic tokens: `bg-btn-primary-bg`, `text-btn-primary-text`, etc. Modal pattern in `ProjectSettings` |
| E2E | `e2e/helpers/mock-backend.ts`, `e2e/types/backend.ts` | Typed mock backend; must be updated for new commands/fields |

### Institutional Learnings

1. **Field naming mismatch is the #1 bug** (docs/solutions/integration-issues/tauri-frontend-backend-field-naming-mismatches). Tauri IPC does NOT auto-convert snake_case ↔ camelCase. New fields (`exit_code`, `last_started_at`) must be handled explicitly in `backendToFrontend`. Event payloads must match exactly.

2. **Atomic session switching** (docs/solutions/best-practices/tauri-v2-pty-streaming-architecture). The `subscribe_output` command atomically snapshots scrollback + attaches Channel. Session card click → `switchSession` → Terminal re-subscribes. This contract must not be broken by the card redesign.

3. **macOS dock lifecycle** (same doc). `RunEvent::Reopen` recreates the picker window. The always-new-window model must integrate with this — dock click should reopen the picker, not a project window.

4. **Keyboard shortcuts** must use `attachCustomKeyEventHandler()`, not Tauri global shortcuts (macOS double-fire bug).

5. **E2E MockBackend** must be updated first when adding commands or changing response shapes (docs/solutions/best-practices/typed-mock-backend-for-tauri-e2e-tests).

## Key Technical Decisions

- **Repurpose `generated_name` field**: No new `display_name` field. `generated_name` stores whatever the user sees — either the `Agent-<hash>` default or a user-chosen name. Simpler migration (existing Haiku names just stay in the field). The `rename_session` command updates this same field.

- **Exit code + `exited_at` from exit watcher**: `portable_pty::ExitStatus::exit_code()` returns `u32` (always populated — signal kills default to 1). Store as `Option<i32>` on Session (None before exit). Also capture `exited_at` timestamp in the exit watcher alongside exit code. This avoids the cold-load problem: after app restart, exited sessions can compute elapsed time from `last_started_at` to `exited_at` without a frontend snapshot.

- **React-based context menu over Tauri native**: No component library exists in the codebase. A lightweight `<ContextMenu>` component (~50 lines) using a positioned `<div>` with portal is simpler than integrating Tauri's native menu API with React state. Click-outside and Escape to dismiss.

- **Single shared timer for elapsed time**: One `setInterval(1000)` in a `useElapsedTime` hook at the SessionPanel level. Provides a `tick` counter that increments every second. Individual cards compute their elapsed duration from `lastStartedAt` + `tick`. Avoids N intervals for N cards.

- **Project-scoped event listeners**: The current `useSessionEvents` hook only listens for the active session's events. This means exit codes and status updates for non-active sessions are silently missed. Fix: refactor event listeners to subscribe to all sessions in the current project, not just the active one. This is essential since all cards now show status, exit code, and last message.

- **4-char hash, not 8**: Requirements specify `Agent-<4chars>` (e.g., `Agent-7f3a`). The current placeholder uses 8 chars. Change to 4 for brevity. Collision risk across realistic session counts (~100s) is negligible with 65k possibilities.

## Open Questions

### Resolved During Planning

- **Window detection for dedup (R1)**: Already solved — `open_project_window` in Rust checks `app.get_webview_window(&label)` with label `project-{id}` and focuses if found. No additional work needed.
- **Context menu approach (R15)**: React-based, not Tauri native. No new dependencies — hand-rolled component following existing Tailwind patterns.
- **Timer approach (R10)**: Single shared interval at SessionPanel level, not per-card intervals.
- **Naming migration (R13)**: No migration. Existing `generated_name` values (Haiku names) are preserved as-is. New sessions get `Agent-<4chars>`. Users can rename any session.

### Deferred to Implementation

- Exact animation/transition for context menu appear/disappear — keep it simple, match existing lack of animation
- Signal-killed process exit code display — `portable_pty` returns `exit_code() == 1` for signal kills. May want to show differently in future, but for now treat same as any non-zero exit

## Implementation Units

- [ ] **Unit 1: Backend — capture exit code + `exited_at`, add rename command, expose `last_started_at`**

**Goal:** Add `exit_code` and `exited_at` to the Session model, capture them in the exit watcher, add a `rename_session` command, and ensure `last_started_at` reaches the frontend.

**Requirements:** R10, R12, R14, R16

**Dependencies:** None

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/sessions.rs`
- Modify: `src-tauri/src/lib.rs` (register `rename_session`)
- Test: `src-tauri/src/commands/sessions.rs` (inline tests) or `src-tauri/tests/` if integration test dir exists

**Approach:**
- Add `exit_code: Option<i32>` and `exited_at: Option<String>` to `Session`, both with `#[serde(skip_serializing_if = "Option::is_none")]`
- In `spawn_exit_watcher`, change `let _exit_status = child.wait()` to capture the result. On `Ok(status)`, extract `status.exit_code()` (returns `u32`, always populated — signal kills return 1). Cast to `i32`. Store both `exit_code` and `exited_at = timestamp_now()` on the session before emitting the exited event. Include `exitCode` and `exitedAt` in the event payload. On `Err`, store `exit_code: None`, `exited_at: Some(timestamp_now())`.
- Add `rename_session(session_id: Uuid, name: String)` command: validates name is non-empty and ≤64 chars, updates `generated_name` in state, persists. No event emission (single-window-per-project, rename is optimistic in the frontend store).
- No change needed for `last_started_at` — it's already serialized by serde. The frontend just wasn't reading it.

**Patterns to follow:**
- `kill_session` for command structure and state update pattern
- Existing `serde(skip_serializing_if)` pattern on `last_message`, `last_started_at`

**Test scenarios:**
- Happy path: `rename_session` updates `generated_name` in state and persists
- Happy path: exit watcher captures exit code 0 and stores it on session with `exited_at` timestamp
- Happy path: exit watcher captures non-zero exit code (e.g., 1) and includes it in event payload
- Edge case: `rename_session` with empty string returns error
- Edge case: `rename_session` with string >64 chars returns error
- Edge case: `rename_session` on non-existent session returns error
- Edge case: `child.wait()` returns Err — session gets `exit_code: None`, `exited_at` still set
- Happy path: signal-killed process reports exit code 1 (portable_pty behavior)

**Verification:**
- `rename_session` command is registered and callable from frontend
- Exit events include `exitCode` and `exitedAt` fields
- `exited_at` is persisted to JSON — survives app restart
- Existing tests still pass

---

- [ ] **Unit 2: Backend — simplify agent naming to `Agent-<4chars>`**

**Goal:** Remove Claude CLI dependency for name generation. New sessions get deterministic `Agent-<4chars>` names.

**Requirements:** R13

**Dependencies:** None (can run in parallel with Unit 1)

**Files:**
- Modify: `src-tauri/src/identity.rs`
- Modify: `src-tauri/src/commands/sessions.rs` (remove `schedule_background_name` call)

**Approach:**
- Replace `identity.rs` contents: keep only `default_name(session_id: Uuid) -> String` that returns `Agent-{first 4 chars of UUID}`. Remove `generate_name`, `try_generate_name`, `parse_name_from_json`, `generate_session_name`, `schedule_background_name`, `schedule_retry`, and all related imports.
- In `create_session`, replace `crate::identity::placeholder_name(session_id)` with `crate::identity::default_name(session_id)` and remove the `schedule_background_name` block (lines 63-72).
- Existing sessions with Haiku names keep them — `generated_name` field is unchanged for persisted data.

**Patterns to follow:**
- Existing `placeholder_name` function signature

**Test scenarios:**
- Happy path: `default_name` returns `Agent-{first 4 chars}` (e.g., UUID `a1b2c3d4-...` → `Agent-a1b2`)
- Happy path: new session creation uses `Agent-<4chars>` as `generated_name`
- Edge case: existing session with Haiku name (e.g., "Maya") is loaded without name reset

**Verification:**
- No references to `claude` CLI binary in codebase
- `identity.rs` has no async code, no `tokio` dependency
- Session creation is synchronous w.r.t. naming (no background tasks)

---

- [ ] **Unit 3: Frontend — update data model, event handling, and project-scoped listeners**

**Goal:** Extend `SessionData` with new fields, update the backend-to-frontend mapping, add `renameSession` to the store, and refactor event listeners to cover all project sessions (not just the active one).

**Requirements:** R9, R10, R12, R14, R16

**Dependencies:** Unit 1 (backend commands must exist)

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/hooks/useSessionEvents.ts`
- Modify: `src/components/Terminal.tsx` (decouple event listening from terminal)
- Modify: `src/components/SessionPanel.tsx` (wire project-scoped listeners)
- Test: `src/stores/__tests__/sessionStore.test.ts` (if exists, or create)

**Approach:**
- Add `lastStartedAt: number | null`, `exitedAt: number | null`, and `exitCode: number | null` to `SessionData` interface
- Update `BackendSession` interface: add `exit_code: number | null`, `exited_at: string | null`
- Update `backendToFrontend`: map `s.last_started_at` → `lastStartedAt` (parse epoch × 1000), `s.exit_code` → `exitCode`, `s.exited_at` → `exitedAt` (parse epoch × 1000)
- Add `renameSession(sessionId: string, name: string)` action: calls `invoke("rename_session", { sessionId, name })`, updates `generatedName` in local state optimistically. On invoke failure, log error (no revert — next `loadSessions` will correct)
- **Refactor event listeners (critical):** Currently `useSessionEvents` is called once in `Terminal.tsx` with `activeSessionId`, so only the active session's events are heard. This means exit codes and status updates for background sessions are silently lost. Refactor to a `useProjectSessionEvents(projectId)` hook that subscribes to events for ALL sessions in the project. Call it from `SessionPanel` instead of `Terminal.tsx`. The hook iterates `sessions` from the store, subscribing to `session-status-{id}` and `session-exited-{id}` for each session. Re-subscribes when the session list changes.
- Remove `session-name-updated` listener entirely (rename is optimistic, no background generation, no cross-window sync needed)
- Update `updateStatus` to accept optional `exitCode` and `exitedAt`, storing both on the session

**Patterns to follow:**
- Existing `backendToFrontend` field mapping
- Existing `killSession` → `invoke` + state update pattern
- Field naming: snake_case from backend, camelCase in frontend (explicit mapping per institutional learning #1)

**Test scenarios:**
- Happy path: `backendToFrontend` correctly maps `last_started_at`, `exit_code`, `exited_at` to camelCase
- Happy path: `renameSession` updates `generatedName` in store
- Happy path: `updateStatus` with exitCode and exitedAt stores both on session
- Edge case: `backendToFrontend` with null `last_started_at`/`exit_code`/`exited_at` maps to `null`
- Integration: non-active session exits → `useProjectSessionEvents` catches the event and updates status + exit code
- Integration: new session created → listener auto-subscribes to its events
- Integration: session deleted → listener unsubscribes from its events

**Verification:**
- `SessionData` includes `lastStartedAt`, `exitedAt`, and `exitCode`
- Events for ALL project sessions are received (not just active)
- `useSessionEvents` no longer listens for `session-name-updated` events
- TypeScript compiles without errors

---

- [ ] **Unit 4: Frontend — multi-window navigation**

**Goal:** Make the picker always open new windows for projects instead of navigating in-place. Remove back-to-picker navigation from project windows.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None (frontend-only, uses existing `open_project_window` backend command)

**Files:**
- Modify: `src-tauri/src/commands/windows.rs` (add `projectPath` to URL params)
- Modify: `src/stores/appStore.ts`
- Modify: `src/components/ProjectPicker.tsx`
- Modify: `src/App.tsx`

**Approach:**
- **Backend `open_project_window`**: Add `projectPath` to URL query params alongside `projectId` and `projectName`. Currently `src-tauri/src/commands/windows.rs` only passes `projectId` and `projectName`, but `ProjectSettings` needs the path for directory context display. Read the project path from state before building the URL.
- **appStore**: Simplify `navigateToProject` to always call `openProjectInNewWindow`. Remove the conditional `windowProjectId` check. The picker window stays on the picker view — it never transitions to `session-view`. Remove `navigateToPicker` (no longer needed in project windows).
- **ProjectPicker**: `handleCardClick` calls `openProjectInNewWindow` directly. After `handleAddProject` → settings close, also open the project in a new window. The picker window never changes its own view.
- **App.tsx**: If URL has `projectId` params → show `SessionView` (no picker, no back button), read `projectPath` from URL params too. If no params → show `ProjectPicker` (no session view). The `currentView` state becomes simpler: picker windows are always pickers, project windows are always session views.
- The `onBack` prop on `SessionView` is removed (no back navigation from project windows).

**Patterns to follow:**
- Existing `open_project_window` invoke pattern in `appStore.openProjectInNewWindow`
- Existing URL param encoding in `commands/windows.rs`

**Test scenarios:**
- Happy path: clicking a project in the picker opens a new OS window (calls `open_project_window`)
- Happy path: clicking a project that already has an open window focuses it (existing backend behavior)
- Happy path: adding a project → configuring settings → opens new window
- Happy path: picker window remains visible after opening a project
- Happy path: project window receives `projectPath` via URL params
- Edge case: picker never shows session-view, even when `navigateToProject` is called
- Edge case: project window has no back button, no way to show picker
- Edge case: project path with special characters is correctly URL-encoded

**Verification:**
- Picker window never transitions to session-view
- Project windows always show session-view immediately on mount
- `projectPath` is available in project windows (not null)
- `onBack` prop removed from SessionView

---

- [ ] **Unit 5: Frontend — SessionView layout restructure + New Session button**

**Goal:** Remove the header bar from SessionView. Move project name + settings gear into the top of the right panel. Restyle "+ New Session" as a prominent button.

**Requirements:** R4, R5, R6, R17

**Dependencies:** Unit 4 (navigation model determines whether header/back exists)

**Files:**
- Modify: `src/components/SessionView.tsx`
- Modify: `src/components/SessionPanel.tsx`

**Approach:**
- **SessionView**: Remove the entire `<header>` element (back button, project name, settings gear). The component becomes just a two-column flex container: `<TerminalView />` + `<SessionPanel />`. Pass `projectId`, `projectName`, `projectPath` to `SessionPanel` instead.
- **SessionPanel**: Add a top section above the session list showing the project name (truncated, `text-sm font-semibold`) and settings gear icon. The settings gear opens `ProjectSettings` modal (move the state management from SessionView into SessionPanel or keep it lifted). The "+ New Session" button gets primary button styling: `bg-btn-primary-bg text-btn-primary-text hover:bg-btn-primary-bg-hover rounded-none px-3 py-2 text-sm font-medium w-full`. Note `rounded-none` for straight corners consistency.

**Patterns to follow:**
- Existing primary button styles from `src/index.css` tokens: `btn-primary-bg`, `btn-primary-text`, `btn-primary-bg-hover`
- Existing settings gear pattern from current SessionView header

**Test scenarios:**
- Happy path: SessionView renders without a header bar
- Happy path: project name and settings gear appear at top of right panel
- Happy path: terminal area takes full window height (no top bar)
- Happy path: "+ New Session" button is visually prominent (solid background)
- Happy path: clicking settings gear opens ProjectSettings modal
- Edge case: long project name truncates in the panel header

**Verification:**
- No `<header>` element in SessionView
- Terminal has `h-screen` equivalent height (no subtraction for header)
- "+ New Session" button uses primary button styling

---

- [ ] **Unit 6: Frontend — session card redesign**

**Goal:** Implement the compact 3-line card layout with straight corners, elapsed time, created-at, exit code, and last message on all cards.

**Requirements:** R7, R8, R9, R10, R11, R12

**Dependencies:** Unit 3 (SessionData must include new fields), Unit 5 (panel structure)

**Files:**
- Create: `src/hooks/useElapsedTime.ts`
- Modify: `src/components/SessionCard.tsx`
- Modify: `src/components/SessionPanel.tsx` (provide tick to cards)
- Test: `src/hooks/__tests__/useElapsedTime.test.ts`

**Approach:**
- **`useElapsedTime` hook**: Single `setInterval(1000)` that increments a `tick` counter. Returns `tick`. Used once in `SessionPanel`, passed as prop to each `SessionCard`. Cards compute elapsed from `lastStartedAt` and current time, using `tick` only as a re-render trigger.
- **Duration formatting**: Helper function `formatElapsed(ms: number) -> string`: <60s → `"34s"`, <1h → `"12m 34s"`, ≥1h → `"1h 12m"`. Running sessions: `Date.now() - lastStartedAt`. Exited sessions: `exitedAt - lastStartedAt` (both are backend-persisted, so elapsed time survives app restart). If either timestamp is null, don't show elapsed time.
- **Card layout** (remove all `rounded-md`, use straight corners):
  - Line 1: `SessionAvatar` (20px) + display name (`text-sm font-medium`) + `StatusIndicator` + exit code badge (if non-zero, `text-xs text-red-500`) + elapsed time (`text-xs text-text-muted`, right-aligned)
  - Line 2: task label (`text-xs text-text-muted`, `pl-7`) + created-at (`text-xs text-text-disabled`, right-aligned)
  - Line 3 (conditional): last message (`text-xs text-text-disabled`, `pl-7`), shown on ALL cards, omitted if empty
- **Created-at formatting**: Helper `formatCreatedAt(timestamp: number) -> string`: same day → `"2:34 PM"`, different day → `"Apr 5 2:34 PM"`.
- **Remove hover action buttons** from card (moved to context menu in Unit 7).

**Patterns to follow:**
- Existing `SessionCard` structure (outer `<button>`, row layout)
- Existing `StatusIndicator` component for status dots
- Existing Tailwind token usage for text colors

**Test scenarios:**
- Happy path: `formatElapsed` returns `"34s"` for 34000ms
- Happy path: `formatElapsed` returns `"12m 34s"` for 754000ms
- Happy path: `formatElapsed` returns `"1h 12m"` for 4320000ms
- Happy path: `formatCreatedAt` returns time-only for today's timestamp
- Happy path: `formatCreatedAt` returns date+time for a different day
- Happy path: running session shows live-updating elapsed time
- Happy path: exited session shows frozen elapsed time
- Happy path: all cards show last message when present
- Happy path: card with no last message renders as 2-line card
- Happy path: non-zero exit code (e.g., 1) renders as red `[1]` badge
- Edge case: exit code 0 is not displayed
- Edge case: session with null `lastStartedAt` shows no elapsed time
- Integration: `useElapsedTime` tick causes all visible cards to re-render elapsed

**Verification:**
- No `rounded-md` or `rounded-lg` on session cards
- All cards show last message (not just active)
- Elapsed time updates every second for running sessions
- Non-zero exit codes are red; exit 0 not shown

---

- [ ] **Unit 7: Frontend — context menu + inline rename**

**Goal:** Add right-click context menu to session cards with Rename, Kill (with confirmation), Restart, Delete. Add double-click inline rename.

**Requirements:** R14, R15

**Dependencies:** Unit 3 (renameSession store action), Unit 6 (card layout without hover buttons)

**Files:**
- Create: `src/components/ContextMenu.tsx`
- Modify: `src/components/SessionCard.tsx`
- Modify: `src/components/SessionPanel.tsx` (manage context menu state)

**Approach:**
- **`ContextMenu` component**: A positioned `<div>` rendered via React portal. Props: `x`, `y`, `items: Array<{label, onClick, disabled?, variant?}>`, `onClose`. Renders at mouse position. Dismissed on click-outside, Escape, or scroll. Uses semantic tokens for styling (`bg-surface border border-border shadow-lg`). Straight corners. Items highlight on hover.
- **Context menu state**: Managed in `SessionPanel` (or a local ref). `onContextMenu` on each `SessionCard` → set menu position + target session. Menu items computed based on session state:
  - Rename — always available
  - Kill — only when `isAlive` (status !== exited && !== done). Shows confirmation dialog (reuse Tauri `confirm()` from `@tauri-apps/plugin-dialog`, same pattern as project removal).
  - Restart — only when `status === "exited"`
  - Delete — only when `!isAlive`
- **Inline rename**: On double-click of the name text (or selecting "Rename" from context menu), replace the name `<span>` with an `<input>`. Props managed via local state on `SessionCard` (`isRenaming: boolean`). Enter → call `renameSession(sessionId, value)` and exit edit mode. Escape or blur → revert to previous name, exit edit mode. Empty value on submit → revert (same as blur).
- **Kill confirmation**: Use `confirm()` from `@tauri-apps/plugin-dialog` — same pattern already used in `ProjectPicker.tsx` for project removal.

**Patterns to follow:**
- `confirm()` dialog pattern from `src/components/ProjectPicker.tsx:43-48`
- Existing Tailwind surface/border tokens for menu styling
- React portal pattern for menu positioning

**Test scenarios:**
- Happy path: right-click on session card opens context menu at cursor position
- Happy path: selecting "Rename" from menu enters inline edit mode
- Happy path: double-click on session name enters inline edit mode
- Happy path: Enter in rename input saves new name via `renameSession`
- Happy path: Escape in rename input reverts to previous name
- Happy path: selecting "Kill" shows confirmation dialog, confirming kills session
- Happy path: selecting "Restart" restarts an exited session
- Happy path: selecting "Delete" removes an exited session
- Edge case: blur during rename reverts to previous name (no change)
- Edge case: submitting empty name reverts to previous name
- Edge case: Kill menu item hidden for exited sessions
- Edge case: Restart menu item hidden for running sessions
- Edge case: clicking outside context menu dismisses it
- Edge case: pressing Escape dismisses context menu
- Edge case: context menu near bottom of panel positions upward

**Verification:**
- No hover-revealed action buttons remain on session cards
- Right-click opens context menu with correct items based on session state
- Double-click on name enters edit mode
- Kill action shows confirmation before executing

---

- [ ] **Unit 8: E2E test updates**

**Goal:** Update the typed mock backend and E2E tests for the new commands, fields, and layout changes.

**Requirements:** All (cross-cutting)

**Dependencies:** Units 1-7 (all feature work complete)

**Files:**
- Modify: `e2e/types/backend.ts`
- Modify: `e2e/helpers/mock-backend.ts`
- Modify: `e2e/session-lifecycle.spec.ts`
- Modify: `e2e/session-view.spec.ts`
- Modify: `e2e/session-actions.spec.ts`
- Modify: `e2e/multi-project.spec.ts`
- Modify: `e2e/project-picker.spec.ts`

**Approach:**
- **Types**: Add `exit_code: number | null` and update `Session` type in `e2e/types/backend.ts`
- **MockBackend**: Add handler for `rename_session`. Update `create_session` mock to return `Agent-<4chars>` names. Update session-exited event emission to include `exitCode`. No `session-name-updated` background events.
- **Broken selectors**: Session cards no longer have hover buttons — tests clicking Kill/Restart/Delete need to use context menu. Session view no longer has a header bar with back button. Project picker no longer navigates in-place.
- **New tests**: Context menu interactions, inline rename, exit code display on cards, elapsed time presence.

**Patterns to follow:**
- Existing MockBackend handler pattern
- Existing Playwright selector patterns in session specs

**Test scenarios:**
- Happy path: mock `rename_session` handler accepts call and returns updated session
- Happy path: context menu opens on right-click and shows correct items
- Happy path: inline rename via double-click changes displayed name
- Happy path: exit code displays for non-zero exits
- Happy path: project selection from picker opens new window (not in-place nav)
- Edge case: exit code 0 is not visible on card
- Integration: full flow — create session → session exits with code 1 → card shows exit code in red

**Verification:**
- All existing E2E tests pass (with selector updates)
- New E2E tests cover context menu, rename, exit code display

## System-Wide Impact

- **Interaction graph:** Session card click → `switchSession` (unchanged). Context menu → `killSession`/`restartSession`/`deleteSession`/`renameSession`. All flow through existing Zustand store actions and Tauri IPC. The atomic `subscribe_output` contract for session switching is not affected — cards still call `switchSession`, Terminal component still handles subscription.

- **Error propagation:** `rename_session` backend errors surface via `invoke` rejection → `console.error` in store. Same pattern as existing `killSession`. No new error UI needed — rename just reverts on failure.

- **State lifecycle risks:** Elapsed time for exited sessions uses backend-persisted `exited_at - last_started_at`, so it survives app restart. Exit code is also backend-persisted. Both arrive via event payload for immediate display and via `loadSessions` for cold-load scenarios.

- **Event contract changes:** `session-exited-{id}` payload gains `exitCode` and `exitedAt` fields. `session-name-updated` events are no longer emitted (rename is optimistic in the frontend store, and each project has exactly one window, so no cross-window sync needed). The critical change is event listener scoping: `useSessionEvents` is replaced by `useProjectSessionEvents` which listens for ALL sessions in the project, not just the active one. This ensures exit codes and status updates are captured for background sessions.

- **Unchanged invariants:** PTY lifecycle, scrollback buffers, hook server, output batching, Cmd+1-9 keybindings (still handled in xterm.js `attachCustomKeyEventHandler`), theme system.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Field naming mismatch on new IPC fields (`exit_code`, `exited_at`, `rename_session` args) | Explicit mapping in `backendToFrontend`. Follow snake_case from backend convention. Test IPC roundtrip in E2E. |
| Event listener re-subscription churn when sessions are created/deleted | `useProjectSessionEvents` should diff session IDs and only add/remove listeners for changed sessions, not teardown all listeners. |
| Context menu positioning near viewport edges | Compute menu position relative to viewport, flip upward if near bottom. Standard pattern. |
| Elapsed time re-renders every second for all visible cards | Single `setInterval`, lightweight computation (subtraction + format). Negligible perf impact for <50 sessions. |
| Removing hover buttons is a UX regression if context menu is undiscoverable | Context menu is a standard desktop pattern. Session cards will have visual affordance (right-click area). Kill confirmation adds safety. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-06-ux-refresh-requirements.md](docs/brainstorms/2026-04-06-ux-refresh-requirements.md)
- Related plan: [docs/plans/2026-04-05-001-feat-seance-v1-plan.md](docs/plans/2026-04-05-001-feat-seance-v1-plan.md)
- Learnings: `docs/solutions/integration-issues/tauri-frontend-backend-field-naming-mismatches-2026-04-05.md`
- Learnings: `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md`
- Learnings: `docs/solutions/best-practices/typed-mock-backend-for-tauri-e2e-tests-2026-04-05.md`
