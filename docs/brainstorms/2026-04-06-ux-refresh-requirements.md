---
date: 2026-04-06
topic: ux-refresh
---

# UX Refresh — Window Model, Session Panel, Naming, and Info Density

> **Revises v1 requirements:** This document supersedes v1's window model (R24, R25, R42), agent naming (R4), session card layout (R34), and the "no session renaming" scope boundary. All other v1 requirements remain in effect.

## Problem Frame

The current Seance UI has a hybrid navigation model (in-window project switching with conditional new windows), generic Haiku-generated agent names that add an external dependency, session cards that show minimal information, and visual inconsistencies (rounded corners on session items vs. straight corners elsewhere). These changes refine the UX toward a cleaner multi-window model, more information-dense session cards, and simpler agent naming with rename support.

## User Flow

```
+------------------+         +------------------+         +------------------+
|  Project Picker  |--click->| Project X Window |         | Project Y Window |
|  (hub, stays     |--click->|                  |         |                  |
|   open always)   |         | [terminal]  [pan]|         | [terminal]  [pan]|
|                  |--add--->| (new project     |         |                  |
|  [proj X] [proj Y]         |  opens here)     |         |                  |
|  [+ Add Project] |         +------------------+         +------------------+
+------------------+
```

## Requirements

**Multi-Window Navigation**

- R1. Selecting a project in the picker opens a dedicated OS window for that project. If a window for that project is already open, focus it instead of opening a duplicate. The picker never navigates to a session view in-place.
- R2. Adding a project via file picker opens a new window for it (after project settings are configured).
- R3. The picker window stays open as a persistent hub after opening project windows.
- R4. The header bar (back button + project name + settings) is removed from the Session View. There is no back-to-picker navigation from project windows.

**Session View Layout**

- R5. The project name and settings gear icon are displayed at the top of the right panel, above the session list — not in a window-spanning header bar. The session panel remains always visible (not collapsible).
- R6. The terminal area occupies the full height of the window (no top bar) on the left side.

```
+------------------------------------------+-----------+
|                                          | Project X |
|                                          |    [gear] |
|   Terminal (full height)                 +-----------+
|                                          | Sessions  |
|   $ claude ...                           |           |
|   > Analyzing files...                   | [cards]   |
|                                          |           |
|                                          |[+New Sess]|
+------------------------------------------+-----------+
```

**Session Card Layout and Styling**

- R7. Session card items use straight corners (no border radius) to match the rest of the UI.
- R8. Session cards use a compact 3-line layout:
  - Line 1: avatar + display name + status indicator + elapsed time (right-aligned)
  - Line 2: task label + created-at timestamp (right-aligned)
  - Line 3: last status message (muted text)

```
+-------------------------------------------+
| [av] Agent-7f3a  *running       12m 34s   |
|      fix-auth-bug            Today 2:34 PM |
|      "Analyzing 12 files..."               |
+-------------------------------------------+

+-------------------------------------------+
| [av] Agent-3a1b  .exited [1]     8m 12s   |
|      feature-payments        Today 1:15 PM |
|      "Done with changes"                   |
+-------------------------------------------+
```

- R9. All session cards show the last status message (not just the active card). If no message has been received, line 3 is omitted (card is 2 lines).
- R10. Session cards show elapsed time: a live-updating duration for running sessions (e.g., "34s", "12m 34s", "1h 12m"), or total runtime for exited sessions. Runtime measures from the most recent start (i.e., `last_started_at`, not `created_at`) to exit.
- R11. Session cards show a created-at timestamp (e.g., "2:34 PM" for today, "Apr 5 2:34 PM" for older).
- R12. Exited session cards show the process exit code only for non-zero exits (e.g., `[1]` in red text next to the status indicator). Exit code 0 is not displayed.

**Agent Naming**

- R13. Drop Haiku-generated human names. New sessions are named `Agent-<short-hash>` where `<short-hash>` is the first 4 characters of the session UUID (e.g., `Agent-7f3a`). Existing sessions with Haiku-generated names retain their current display name on upgrade.
- R14. Sessions can be renamed via double-click on the session name: the name text becomes an inline input. Enter saves, Escape cancels. Clicking away (blur) or submitting an empty string reverts to the previous name (no change).
- R15. Right-click on a session card opens a context menu with: Rename, Kill (if alive), Restart (if exited), Delete (if not alive). Kill requires a confirmation dialog. The existing hover-revealed action buttons are removed — the context menu is the sole path to these actions.
- R16. The display name is persisted and survives app restart. The `Agent-<hash>` default is only used if no custom name has been set.

**New Session Button**

- R17. The "+ New Session" control is styled as a prominent button (solid background, not just a text link). It should be visually distinct and easy to find. Clicking it reveals the inline task-label input as before (v1 R37 behavior).

## Success Criteria

- Each project opens in its own dedicated OS window; the picker always stays open
- Session cards show name, task, status, elapsed time, created-at, last message, and exit code (when applicable) — all scannable without switching sessions
- Users can rename sessions via double-click or context menu
- No external dependency on Claude CLI for name generation
- Visual consistency: straight corners throughout

## Scope Boundaries

- No changes to terminal behavior, PTY management, or hook server
- No drag-to-reorder or search for sessions
- No changes to project settings or command template UX
- No window state restoration across app restarts (on app launch, the Project Picker always opens fresh)
- The `generatedName` field in the backend is repurposed for the `Agent-<hash>` default; Haiku name generation code is removed
- Session avatars are retained — they remain derived from the session UUID

## Key Decisions

- **Always-new-window with dedup**: Every project gets its own window. If the window is already open, focus it. Eliminates the hybrid in-window/new-window navigation for a simpler mental model.
- **Picker as persistent hub**: Stays open so you can rapidly open multiple projects. Dock icon also reopens it if closed.
- **Agent-<hash> over Haiku names**: Removes the Claude CLI dependency for name generation. Simpler, deterministic, no failure modes. Users who want meaningful names can rename. Existing Haiku names preserved on upgrade.
- **Context menu replaces hover buttons**: Consolidates Kill, Restart, Delete, Rename into right-click. Cleaner cards with one interaction model. Kill retains confirmation.
- **All cards show last message**: Key for an orchestration tool — you need to scan what all agents are doing without clicking each one.
- **Only non-zero exit codes shown**: Exit 0 is the happy path — no visual noise. Non-zero displayed in red for failure scanning.

## Dependencies / Assumptions

- Tauri v2 context menu support (or a React-based context menu component)
- The existing `open_project_window` Tauri command works for the always-new-window model
- `created_at` is already a persisted field in the session data model (v1 R28)

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] How to detect if a window for a given project is already open — Tauri window labels keyed by project ID is the likely approach, needs validation.
- [Affects R15][Needs research] Tauri v2 native context menu vs. React-based context menu — which integrates better with the existing stack?
- [Affects R10][Technical] Timer implementation for live elapsed time — a single shared interval triggering re-renders is preferred over per-card intervals.

## Next Steps

-> `/ce:plan` for structured implementation planning
