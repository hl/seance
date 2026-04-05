---
date: 2026-04-05
topic: seance-v1
---

# Seance v1 — AI Agent Session Orchestrator

## Problem Frame

Developers running multiple AI coding agents across multiple projects currently manage them as disconnected terminal windows. There is no unified view of what each agent is doing, no way to quickly switch between sessions with scrollback, and no identity system to distinguish agents at a glance. Seance provides a single desktop interface for launching, monitoring, and interacting with agent sessions, with a hook mechanism for real-time status updates.

## User Flow

```
              +------------------+
              |  Project Picker  |
              |  (home screen)   |
              +--------+---------+
                       |
            +----------+----------+
            |                     |
     Add Project           Click Project
     (file picker            |
      -> settings)           v
                    +------------------+
                    |   Session View   |<--+
                    |  (per project,   |   |
                    |   own window)    |   |
                    +--------+---------+   |
                             |             |
              +--------------+---------+   |
              |              |         |   |
        New Session   Click Session  Restart
        (enter task    (switch PTY,  (exited
         label)        replay        sessions
              |        scrollback)   only)
              v              |         |
        Agent spawns         v         |
        in PTY with    Terminal shows  |
        env vars       session output--+
              |
              v
        Hook POSTs update
        status indicators
        in real time
```

## Session View Layout

```
+--------------------------------------------------------+
| Project Name                     [settings]    [back]  |
+----------------------------------------+---------------+
|                                        |               |
|                                        | + New Session  |
|                                        |               |
|   Terminal (active session)            | [*] Maya         run
|                                        |     fix-auth-bug
|   $ claude ...                         |     "Analyzing 12 files..."
|   > Analyzing files in src/auth...     |
|   > Reading src/auth/middleware.rs     | [*] Felix        wait
|                                        |     feature-payments
|                                        |
|                                        | [.] Ada          exit
|                                        |     refactor-db
|                                        |
|                                        |               |
+----------------------------------------+---------------+

Left: fluid-width terminal (xterm.js)
Right: fixed ~280px session panel, always visible
Active card shows last status message; others show avatar + name + task only
Cmd+1/2/3 switches by list position (creation order, stable)
```

## Requirements

**Core Session Management**

- R1. Each session spawns a configurable command in a PTY, keyed by a stable UUID assigned at creation
- R2. Sessions remain alive independently of which session is actively viewed in the frontend
- R3. The user assigns a slug-formatted task label when creating a session (lowercase, hyphens, no spaces — e.g. "fix-auth-bug", "feature-payments"). Enforced at input time since `{{task}}` is interpolated into shell commands
- R4. Each session is represented as an "agent" with a human first name generated via the Claude CLI (`claude -p <prompt> --model haiku --output-format json`, assumes Claude Code is installed and authenticated) and a geometric SVG avatar derived from its UUID. If the CLI call fails, the session gets a placeholder name (e.g. "Agent-7f3a") and retries in the background.
- R5. Exited sessions can be restarted via a user-initiated action: re-spawn the same command with the same UUID, name, avatar, and task label; the in-memory scrollback buffer is reset and status immediately becomes `running` (no intermediate state)
- R6. A kill action terminates a running session's PTY process, with confirmation

**Terminal Interaction**

- R7. The frontend embeds a fully interactive xterm.js terminal per active session — all keyboard input forwarded to the PTY
- R8. The terminal resizes dynamically with the window
- R9. Switching sessions replays the target session's scrollback buffer before subscribing to live output
- R10. The backend maintains a bounded in-memory scrollback buffer (default 10,000 lines) per session

**Status System**

- R11. Each session has a status: `running` | `thinking` | `waiting` | `done` | `error` | `exited`
- R12. Initial status on spawn is `running`; transitions to `exited` on process exit (regardless of exit code); all other transitions (`thinking`, `waiting`, `done`, `error`) come exclusively from hook POSTs and can transition freely between each other
- R13. Status indicators: `running` = animated green pulse, `thinking` = animated amber pulse, `waiting` = static blue dot, `done` = static grey dot, `error` = static red dot, `exited` = static dark grey dot
- R14. The last status message received from the agent is shown as muted text on the session card

**Hook Server**

- R15. The backend runs a local HTTP server (default port 7837, configurable) with one endpoint: `POST /session/:session_id/status`
- R16. If the port is in use at startup, the app shows an error and prompts the user to change the port before sessions can spawn
- R17. The backend injects `SEANCE_SESSION_ID`, `SEANCE_HOOK_PORT`, and `SEANCE_HOOK_URL` environment variables into each spawned process
- R18. The app does not manage hook script installation — users configure their agent hooks separately

**Project Management**

- R19. Users register project directories via a system file picker; project settings open immediately so the command template is configured before any session is created
- R20. The command template supports placeholders: `{{session_name}}`, `{{task}}`, `{{project_dir}}`
- R21. A live preview of the resolved command is shown beneath the template input using sample values
- R22. Removing a project with active sessions prompts for confirmation and kills all its sessions

**Navigation and Windows**

- R23. The Project Picker is the home screen, showing all registered projects with active session count and avatar stack
- R24. Clicking a project from the Project Picker replaces the picker with that project's Session View in the same window
- R25. If a project is already open in a window, clicking a different project from the picker (or from any window's back-to-picker action) opens the new project in a new OS window
- R26. Closing a project's window does not kill its sessions; reopening the project re-attaches and replays scrollback from the in-memory buffer (scrollback does not survive app restart — see R29)
- R27. Global settings are accessible only from the Project Picker; project settings are accessible from the Session View header
- R42. The back button in Session View always shows the Project Picker in the same window (even if a picker is already open in another window — duplicate pickers are allowed)
- R43. On app launch, a single Project Picker window opens regardless of what was open before. No window state restoration.
- R44. Closing all windows does not quit the app — the process stays alive with a dock icon. Sessions continue running. Clicking the dock icon reopens the Project Picker. Quitting via Cmd+Q or the dock menu kills all sessions and exits.

**Persistence**

- R28. Projects and sessions are persisted to a JSON file in the app data directory (flat structure, joined by `project_id`)
- R29. PTY processes and scrollback buffers are not persisted across app restarts — sessions load with `exited` status, empty scrollback, and can be restarted

**Session Lifecycle**

- R39. If a spawned command is invalid (binary not found, bad path), the session is still created with its identity. The PTY exits immediately and the terminal displays the shell error. No pre-spawn validation — the terminal output is the error surface.
- R40. When a process exits, the terminal retains all output. The session card status updates to `exited`. No overlay, banner, or prompt in the terminal area.
- R41. On restart, the previous status message is cleared along with scrollback. The session transitions directly to `running`.

**Session View Layout**

- R32. Two-column layout: terminal on the left (fluid width), fixed-width session panel on the right (~280px)
- R33. Session panel is always visible (not collapsible)
- R34. Session cards show: avatar + generated name + status dot on one line, task label below in smaller text. The active session's card also shows the last status message as muted text
- R35. Sessions are ordered by creation time (oldest first, newest at bottom); positions are stable
- R36. Cmd+1 through Cmd+9 switch to sessions by list position (handled at Tauri level, above xterm.js key capture)
- R37. Creating a new session: clicking "+ New Session" reveals an inline text input at the bottom of the session list; user types a task label and presses Enter to spawn
- R38. Empty state (no sessions): terminal area shows a centered "No sessions yet" prompt; the "+ New Session" button is visible in the right panel

**Settings**

- R30. Global settings: hook server port, terminal font size, terminal theme (light/dark/system)
- R31. Project settings: command template with placeholder support and validation

## Success Criteria

- A user can register a project, configure a command template, spawn multiple agent sessions, and interact with each via embedded terminal
- Sessions persist across window close/reopen within an app session, with full scrollback replay
- Agent hook POSTs update session status indicators in real time
- Exited sessions can be restarted with the same identity
- The interface feels like managing a room of named agents, not a list of terminals

## Scope Boundaries

- No auto-discovery of existing agent sessions from disk
- No integration with Claude Code or Codex internals
- No MCP server exposure (v2 consideration)
- No session renaming after creation
- No drag-to-reorder, search, or export of sessions
- No OS-level notifications on status change
- Desktop only (macOS first) — no mobile or web

## Key Decisions

- **"task" not "worktree"**: The user-assigned session label is called "task" — a generic free-form label with no git semantics. The placeholder in command templates is `{{task}}`.
- **Haiku-generated agent names**: Each session gets a human first name via the Claude CLI (Haiku model), not a deterministic codename. Assumes Claude Code is installed and authenticated. Placeholder + background retry on failure.
- **Session restart in v1**: Exited sessions get a restart action that re-spawns with the same identity. Scrollback is cleared on restart to keep it simple.
- **Multi-window model**: Each project opens in its own OS window. Project Picker is the hub. No tabs.
- **Tool-agnostic**: The command template is fully configurable — Seance works with any CLI agent, not just Claude Code.

## Technology Stack

| Layer | Choice |
|---|---|
| Desktop framework | Tauri v2 |
| Backend | Rust |
| PTY management | `portable-pty` |
| Hook server | `axum` |
| Frontend | React 19 + TypeScript |
| Terminal | `@xterm/xterm` v6 |
| Styling | Tailwind CSS |
| Build | Vite |
| State | Zustand |

## Dependencies / Assumptions

- Tauri v2 multi-window support is stable on macOS
- `portable-pty` supports spawning arbitrary commands with custom environment variables
- `@xterm/xterm` v6 can render scrollback buffers performantly (needs validation during planning — v6 removed canvas renderer, only DOM and WebGL remain)

## Outstanding Questions

### Deferred to Planning

- [Affects R7, R9][Needs research] PTY-to-frontend data path: threading model for PTY reads (`portable-pty` is blocking), and Tauri IPC mechanism (Events vs Channels vs `tauri-plugin-pty`). This is the most critical architectural decision.
- [Affects R9, R10][Technical] Scrollback buffer representation: raw bytes replayed into xterm.js (simple, potential flicker) vs. parsed terminal state snapshots (complex, smooth). Also needs a byte-cap fallback — 10k lines can vary from 800KB to 30MB+.
- [Affects R15][Needs research] axum/Tauri runtime coexistence: spawn axum on Tauri's tokio runtime (shared state access) or separate runtime on dedicated thread (isolated but needs channel bridge).
- [Affects R25][Needs research] Tauri v2 multi-window lifecycle — how does the backend distinguish between "user closed this project's window" and "app is shutting down" for cleanup? Also: event routing strategy for status updates across multiple windows.
- [Affects R1, R6][Technical] PTY process cleanup on app exit/crash — orphaned AI agents continuing to run silently is a meaningful failure mode. Consider storing PIDs for crash recovery.
- [Affects R7][Technical] Output batching/backpressure between PTY reads and frontend writes during burst output (e.g. builds, large file dumps).
- [Affects R4][Technical] Word list curation for generated names — how many adjectives/nouns are needed to avoid collisions across realistic session counts?
- [Affects R15][Technical] Should the hook server validate `session_id` against known sessions and reject unknown IDs, or accept any POST silently?
- [Affects R5][Technical] On restart, should the session's `created_at` timestamp update, or should a separate `last_started_at` be tracked?
- [Affects R28][Technical] JSON persistence write strategy: atomic write-and-rename vs. periodic flush vs. write-on-change. Affects crash resilience.

## Next Steps

-> `/ce:plan` for structured implementation planning
