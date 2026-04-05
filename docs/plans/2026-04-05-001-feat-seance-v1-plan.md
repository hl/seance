---
title: "feat: Build Séance v1 — AI Agent Session Orchestrator"
type: feat
status: completed
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-seance-v1-requirements.md
---

# feat: Build Séance v1 — AI Agent Session Orchestrator

## Overview

Build a greenfield Tauri v2 desktop application that lets developers orchestrate multiple AI coding agent sessions across multiple projects from a single interface. Each session runs in a PTY with an embedded xterm.js terminal, gets a generated identity (name + avatar), and can push status updates back to the UI via a local HTTP hook server.

## Problem Frame

Developers running multiple AI coding agents across multiple projects manage them as disconnected terminal windows. There is no unified view of what each agent is doing, no way to quickly switch between sessions with scrollback, and no identity system to distinguish agents at a glance. Séance provides a single desktop interface for launching, monitoring, and interacting with agent sessions. (see origin: `docs/brainstorms/2026-04-05-seance-v1-requirements.md`)

## Requirements Trace

**Core Session Management:** R1–R6
**Terminal Interaction:** R7–R10
**Status System:** R11–R14
**Hook Server:** R15–R18
**Project Management:** R19–R22
**Navigation and Windows:** R23–R27, R42–R44
**Persistence:** R28–R29
**Session Lifecycle:** R39–R41
**Session View Layout:** R32–R38
**Settings:** R30–R31

Full requirements in origin document.

## Scope Boundaries

- No auto-discovery of existing agent sessions from disk
- No integration with Claude Code or Codex internals
- No MCP server exposure (v2 consideration)
- No session renaming after creation
- No drag-to-reorder, search, or export of sessions
- No OS-level notifications on status change
- Desktop only (macOS first) — no mobile or web

## Context & Research

### Technology Stack

| Layer | Package | Version |
|-------|---------|---------|
| Desktop framework | `tauri` | 2.10.x |
| Backend | Rust | stable |
| PTY management | `portable-pty` | 0.9.x |
| Hook server | `axum` | 0.8.x |
| Async runtime | `tokio` | 1.x (shared with Tauri) |
| Signal handling | `signal-hook` | 0.3.x |
| Serialization | `serde` / `serde_json` | 1.x |
| UUID | `uuid` | 1.x |
| Frontend framework | React | 19.x |
| Language | TypeScript | 5.x |
| Terminal | `@xterm/xterm` | 6.x |
| Terminal renderer | `@xterm/addon-webgl` | 0.19.x |
| Terminal fit | `@xterm/addon-fit` | latest |
| Styling | Tailwind CSS | 4.x |
| Build | Vite | 6.x |
| State | Zustand | 5.x |

### Institutional Learnings

No `docs/solutions/` directory exists. Greenfield project with no prior solution history.

### External References

- Tauri v2 multi-window: `WebviewWindowBuilder::new(&app, label, url)`, `emit_to(label, event, payload)`, `RunEvent::Reopen` for dock click
- Tauri v2 Channels: recommended for streaming data, `Channel<T>` generic type, `Channel<Vec<u8>>` serializes as JSON number array
- portable-pty: blocking I/O requires `std::thread::spawn`, `try_clone_reader()` for reader, `take_writer()` once only, `clone_killer()` for cross-thread termination
- axum 0.8.x: path parameters use `{param}` syntax (changed from `:param` in 0.7)
- xterm.js v6: all packages under `@xterm/` scope, canvas renderer removed, WebGL recommended, `attachCustomKeyEventHandler()` for intercepting shortcuts
- Zustand v5: `import { create } from 'zustand'`, `useShallow` for multi-property selectors
- Full stack documentation: `docs/research/2026-04-05-stack-documentation.md`

## Key Technical Decisions

- **PTY reader threading**: Dedicated OS thread per session via `std::thread::spawn` (not `tokio::spawn_blocking` — PTY reads are unbounded blocking work). Bridge to async via `tokio::sync::mpsc`. This is the pattern WezTerm uses internally.
- **Tauri IPC for terminal output**: Channels (`Channel<Vec<u8>>`), not Events. Channels are ordered, designed for streaming, and used internally by Tauri for child process output. `Vec<u8>` serializes as JSON number array — acceptable overhead for terminal output volumes (KB per batch after batching).
- **axum on Tauri's runtime**: Spawn axum via `tauri::async_runtime::spawn()` in the setup hook. Single shared `Arc<AppState>` accessible from both Tauri commands and axum handlers. No separate runtime — the hook server handles trivial load.
- **Scrollback as raw bytes**: Store raw PTY output bytes with an 8MB byte-cap. This replaces R10's "10,000 lines" with a byte-based limit because line size varies wildly (80 bytes to several KB). 8MB accommodates roughly 10k typical lines while preventing unbounded memory growth. Replay by writing the entire buffer as `Uint8Array` to xterm.js. Accept potential visual "painting" on replay — xterm.js handles large writes asynchronously via its internal `WriteBuffer`.
- **Output batching**: 8ms / 200KB time-windowed accumulation in the PTY reader thread before sending to the Tauri channel. Empirically validated by Hyper terminal's batching PR (57% throughput improvement, consistent 40+ FPS).
- **Process cleanup**: Multi-layer — SIGHUP → 500ms grace → SIGKILL on app exit. PID persistence in JSON file for orphan cleanup on next launch. `signal-hook` for unexpected termination. Use `master.process_group_leader()` (not child PID) with `killpg` to kill entire process trees. The same SIGHUP → grace → SIGKILL escalation applies to the interactive `kill_session` command, not just app exit.
- **Keyboard shortcuts**: `attachCustomKeyEventHandler()` in xterm.js for Cmd+1–9 (not Tauri global shortcuts — those have a known double-fire bug on macOS and register system-wide).
- **xterm.js WebGL renderer**: Use `@xterm/addon-webgl` for GPU-accelerated rendering. Fall back to DOM renderer if WebGL context creation fails (browsers limit ~16 contexts).
- **Hook session validation**: Validate `session_id` against known sessions, return 404 for unknown IDs.
- **Persistence**: Atomic write-and-rename on every mutation. Data is small (project/session metadata only, not scrollback).
- **Session restart**: Add `last_started_at` field alongside `created_at`. On restart, `created_at` stays, `last_started_at` updates.
- **Name generation**: Human first names generated via Claude CLI (`claude -p <prompt> --model haiku --output-format json`) at session creation time. No API key management needed — assumes Claude Code is installed and authenticated. On failure, use placeholder "Agent-{short_uuid}" and retry in background. Name stored in session model once generated.

## Open Questions

### Resolved During Planning

- **PTY crate choice**: `portable-pty` 0.9.x. Avoid `tauri-plugin-pty` (immature, 18 stars, "Developing!" status). Avoid `rust-pty` 0.1.0 (too new). `pty-process` with async feature is viable but less proven for terminal emulators.
- **axum path syntax**: 0.8.x uses `{session_id}` not `:session_id`. Route: `/session/{session_id}/status`.
- **Multi-window event routing**: Use `emit_to(format!("project-{}", project_id), ...)` for session status updates to specific project windows. Use `emit(...)` broadcast for Project Picker updates (session count changes).
- **Window labels**: `project-{project_id}` for project windows, `picker` or `picker-{n}` for Project Picker windows (duplicates allowed per R42).
- **Cmd+1-9 implementation**: Via `attachCustomKeyEventHandler()` in xterm.js, not Tauri global shortcuts. When intercepted, call Tauri command to switch session. Only active when terminal has focus — matches expected behavior.
- **State sharing pattern**: Tauri `.manage(Arc<AppState>)` for commands. Clone the `Arc` for axum's `with_state()`. Use `tokio::sync::RwLock` (not `std::sync::Mutex`) because locks may be held across `.await` points.

### Deferred to Implementation

- **Haiku prompt tuning**: The exact prompt for generating agent first names may need iteration to get names that feel right (not too common, not too unusual, varied across cultures).
- **SVG avatar geometry specifics**: Which shapes (circle, triangle, hexagon, diamond, etc.) look best at small sizes. Will need visual iteration.
- **xterm.js scrollback replay smoothness**: Whether DEC private mode 2026 (synchronized output) helps reduce visual flicker during replay. Depends on runtime testing.
- **WebGL context limit handling**: How many simultaneous sessions hit the ~16 WebGL context browser limit. May need to share a single WebGL context or fall back to DOM for non-active sessions.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Architecture Overview
=====================

┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Process                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    AppState (Arc)                         │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐   │   │
│  │  │  Projects    │  │   Sessions   │  │  App Settings │   │   │
│  │  │  HashMap     │  │   HashMap    │  │               │   │   │
│  │  └─────────────┘  └──────────────┘  └───────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│          │                    │                                  │
│          │    ┌───────────────┼──────────────────┐              │
│          │    │               │                  │              │
│  ┌───────┴────┴──┐   ┌───────┴──────┐   ┌──────┴───────┐      │
│  │ Tauri Commands │   │  PTY Engine  │   │  Hook Server │      │
│  │ (CRUD, input,  │   │ (per-session │   │  (axum on    │      │
│  │  resize, etc.) │   │  OS threads) │   │  Tauri tokio)│      │
│  └───────┬────────┘   └──────┬───────┘   └──────┬───────┘      │
│          │                   │                   │              │
│          │            Channel<Vec<u8>>    emit_to / emit        │
│          │              (streaming)       (status updates)      │
│          │                   │                   │              │
└──────────┼───────────────────┼───────────────────┼──────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (per window)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Zustand Store │  │  xterm.js    │  │  React Views         │  │
│  │ (sessions,   │  │  (WebGL      │  │  - Project Picker    │  │
│  │  projects,   │  │   renderer,  │  │  - Session View      │  │
│  │  status)     │  │   fit addon) │  │  - Settings          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Data Flow: PTY Output
=====================

  portable-pty        OS Thread          tokio task        Frontend
  ┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────┐
  │ PTY read │───>│ Batch 8ms/  │───>│ mpsc recv   │───>│ Channel │
  │ (blocking)│   │ 200KB accum │    │ → Channel   │    │ onmsg   │
  └─────────┘    │ → mpsc send │    │    .send()  │    │ → write │
                 └──────────────┘    └─────────────┘    │ Uint8Arr│
                                                        └─────────┘
                        Also: append to scrollback buffer (8MB cap)

Data Flow: Hook Status
======================

  Agent Hook         axum handler        Tauri event       Frontend
  ┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────┐
  │ curl POST│───>│ Validate ID │───>│ Update state│───>│ Zustand │
  │ to :7837 │    │ Update state│    │ emit_to     │    │ re-render│
  └─────────┘    └──────────────┘    └─────────────┘    └─────────┘
```

## Implementation Units

### Phase 1: Foundation

- [ ] **Unit 1: Project Scaffold**

**Goal:** Create a working Tauri v2 + React 19 project with all dependencies installed and a blank window rendering.

**Requirements:** Foundation for all requirements.

**Dependencies:** None.

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/build.rs`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`

**Approach:**
- Use `create-tauri-app` pattern but set up manually to control exact versions
- Cargo dependencies: `tauri` (with features: `macos-private-api`), `tauri-build`, `serde`, `serde_json`, `tokio`, `uuid`, `portable-pty`, `axum`, `signal-hook`
- npm dependencies: `@tauri-apps/api`, `@tauri-apps/plugin-dialog` (file picker), `react`, `react-dom`, `@xterm/xterm`, `@xterm/addon-webgl`, `@xterm/addon-fit`, `zustand`, `tailwindcss`, `@tailwindcss/vite`, `vite`, `@vitejs/plugin-react`, `typescript`
- Tailwind CSS v4 uses CSS-first configuration (`@import "tailwindcss"` in CSS) and the `@tailwindcss/vite` plugin — no `tailwind.config.ts` file
- Configure `tauri.conf.json` with security settings, window defaults (1200×800), and build configuration
- Verify: `cargo tauri dev` launches a blank window

**Test expectation:** none — pure scaffolding.

**Verification:**
- `cargo tauri dev` compiles and opens a window with the React app rendering
- No console errors in the webview dev tools

---

- [ ] **Unit 2: Backend State, Persistence, and Project CRUD**

**Goal:** Implement the core data model, JSON persistence, and all project management Tauri commands.

**Requirements:** R19, R20, R21, R22, R28, R29, R30, R31

**Dependencies:** Unit 1

**Files:**
- Create: `src-tauri/src/state.rs`
- Create: `src-tauri/src/persistence.rs`
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/commands/projects.rs`
- Create: `src-tauri/src/commands/settings.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/persistence_test.rs` or `src-tauri/tests/persistence.rs`

**Approach:**
- `AppState` struct: `Arc` wrapping inner state with `tokio::sync::RwLock` for projects, sessions, and settings HashMaps
- Models: `Project { id, path, command_template, created_at }`, `Session { id, project_id, task, generated_name, status, last_message, created_at, last_started_at, last_known_pid }`, `AppSettings { hook_port, terminal_font_size, terminal_theme }`, `SessionStatus` enum
- Persistence: load from JSON on startup, atomic write (write to `.tmp`, rename) on every mutation
- App data directory via `app.path().app_data_dir()`
- Tauri commands: `list_projects`, `add_project(path)`, `remove_project(id)`, `update_project_settings(id, settings)`, `get_app_settings`, `update_app_settings(settings)`
- Register state via `tauri::Builder::default().manage(state)`
- Template placeholder resolution: function that substitutes `{{session_name}}`, `{{task}}`, `{{project_dir}}` in command strings. Validate template is non-empty.

**Patterns to follow:**
- Tauri state management: `.manage(Arc<AppState>)`, access via `tauri::State<'_, Arc<AppState>>`

**Test scenarios:**
- Happy path: create project, list projects returns it with correct fields
- Happy path: update project settings, verify command template persists
- Happy path: remove project, verify it's gone from list
- Edge case: add project with path that doesn't exist — should succeed (path validity is not Séance's concern)
- Edge case: remove project that doesn't exist — should return error
- Happy path: persistence round-trip — save state, reload from file, verify data matches
- Edge case: missing/corrupt JSON file on startup — should initialize empty state
- Happy path: atomic write — verify temp file is used, then renamed
- Happy path: template resolution — `{{session_name}}` / `{{task}}` / `{{project_dir}}` substituted correctly
- Edge case: template with unknown placeholder — passed through verbatim (don't error)

**Verification:**
- Tauri commands callable from frontend dev tools
- Closing and reopening the app preserves project data
- Corrupt JSON file recovery works (empty state, no crash)

---

### Phase 2: PTY Engine

- [ ] **Unit 3: PTY Spawning, I/O Streaming, and Scrollback**

**Goal:** Implement the core PTY engine: spawn sessions, stream output to the frontend via Channels, accept input, resize, kill, and maintain scrollback buffers.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R17, R39, R40, R41

**Dependencies:** Unit 2

**Files:**
- Create: `src-tauri/src/pty_engine.rs`
- Create: `src-tauri/src/scrollback.rs`
- Create: `src-tauri/src/commands/sessions.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/scrollback.rs`
- Test: `src-tauri/tests/pty_engine.rs`

**Approach:**
- `SessionHandle` struct per active session: holds `ChildKiller` (from `portable-pty`), writer (`Arc<Mutex<Box<dyn Write>>>`), output channel sender, scrollback buffer reference
- Spawning: `portable_pty::native_pty_system().openpty()`, `CommandBuilder` with `.env()` for `SEANCE_SESSION_ID`, `SEANCE_HOOK_PORT`, `SEANCE_HOOK_URL`, `.cwd()` for project dir. `drop(pair.slave)` after spawn — critical for EOF delivery.
- Reader thread: `std::thread::spawn` with blocking `read()` loop. Batching: accumulate for 8ms or 200KB, then `tx.blocking_send(batch)`. Also append each chunk to scrollback buffer.
- Async forwarder: `tauri::async_runtime::spawn` task that receives from `mpsc` and calls `channel.send(data)` on the Tauri `Channel<Vec<u8>>`.
- Scrollback buffer: `Vec<u8>` with 8MB byte cap. Trim from front on overflow, finding nearest newline boundary. Reset on session restart.
- Writer: stored in `Arc<Mutex<_>>` — `take_writer()` can only be called once.
- Tauri commands:
  - `create_session(project_id, task, on_output: Channel<Vec<u8>>)` — validate task slug format, generate UUID, generate name, resolve template, spawn PTY, return session info
  - `kill_session(session_id)` — send SIGHUP via `ChildKiller`, mark as exited
  - `send_input(session_id, data: String)` — encode to UTF-8 bytes on the Rust side, write to PTY writer. Accepts `String` because xterm.js `onData` provides JavaScript strings.
  - `resize_pty(session_id, cols, rows)` — resize PTY
  - `get_scrollback(session_id)` — return scrollback buffer bytes
  - `restart_session(session_id, on_output: Channel<Vec<u8>>)` — reset scrollback, clear status/message, re-spawn with same identity, update `last_started_at`
  - `subscribe_output(session_id, on_output: Channel<Vec<u8>>)` — atomically snapshots the scrollback buffer AND attaches a new Channel to the session's output stream in one operation. Returns the scrollback bytes. This prevents a race where output produced between a separate `get_scrollback` call and a `subscribe` call would be lost. The command also creates a new forwarder task (the previous one may have exited if the window was closed).
- Exit detection: separate thread watching `child.wait()`. On exit, update status to `exited`, emit `session-exited-{session_id}` event.
- Process cleanup on app exit: `RunEvent::Exit` handler iterates all sessions, sends SIGHUP, waits 500ms, sends SIGKILL. PID persistence for orphan cleanup on next launch. `signal-hook` for SIGTERM/SIGINT.

**Technical design:**

> *Directional guidance — the reader/forwarder/exit-watcher threading model:*

```
create_session():
  1. Generate UUID, name, resolve template
  2. openpty() → PtyPair
  3. spawn_command() → Child
  4. drop(slave)
  5. try_clone_reader() → reader
  6. take_writer() → writer (store in Arc<Mutex>)
  7. clone_killer() → killer (store for kill command)
  8. Store child PID in session metadata + persist
  9. Start reader thread:
     std::thread::spawn:
       loop { read() → batch → mpsc_tx.blocking_send() + scrollback.append() }
  10. Start forwarder task:
      tauri::async_runtime::spawn:
        loop { mpsc_rx.recv() → channel.send() }
  11. Start exit watcher:
      std::thread::spawn:
        child.wait() → update status to exited → emit event
```

**Patterns to follow:**
- WezTerm's PTY reader pattern (dedicated OS thread, not tokio)
- Hyper terminal's output batching (8ms/200KB empirically optimal)

**Test scenarios:**
- Happy path: scrollback buffer append and retrieval — write 100 chunks, read back, verify content matches
- Edge case: scrollback buffer overflow — write >8MB, verify oldest data is trimmed at newline boundary
- Edge case: scrollback buffer reset — clear buffer, verify empty
- Happy path: template resolution with all three placeholders
- Edge case: task slug validation — reject spaces, uppercase, special chars; accept lowercase-with-hyphens
- Error path: spawn with invalid command — session created, exits immediately, status becomes `exited`
- Integration: create session → send input → receive output (requires PTY, end-to-end)
- Happy path: kill session — verify process is terminated, status becomes `exited`
- Happy path: restart session — verify scrollback cleared, status is `running`, same UUID/name

**Verification:**
- A session can be created, produces output visible in the frontend Channel
- Input sent to the session appears in the PTY
- Scrollback buffer can be retrieved after the session produces output
- Killing a session terminates the process
- Restarting an exited session re-spawns with the same identity

---

### Phase 3: Hook Server

- [ ] **Unit 4: axum Hook Server and Status System**

**Goal:** Run a local HTTP server alongside Tauri that receives status updates from agent hooks and propagates them to the frontend.

**Requirements:** R11, R12, R13, R14, R15, R16, R17, R18

**Dependencies:** Unit 2 (state), Unit 3 (sessions exist to update)

**Files:**
- Create: `src-tauri/src/hook_server.rs`
- Modify: `src-tauri/src/lib.rs` (setup hook)
- Modify: `src-tauri/src/state.rs` (AppHandle storage for event emission)
- Test: `src-tauri/tests/hook_server.rs`

**Approach:**
- In Tauri setup hook: `tauri::async_runtime::spawn(start_hook_server(state, app_handle, port))`
- axum router: `Router::new().route("/session/{session_id}/status", post(handle_status))` with `Arc<AppState>` and `AppHandle` in state
- `StatusUpdate` struct: `{ status: SessionStatus, message: Option<String> }` — deserialize with serde
- Handler: validate `session_id` exists (404 if not), update session status and `last_message` in state, emit `session-status-{session_id}` event via `app_handle.emit_to(...)` to the project window, emit broadcast for picker session count
- Port binding: attempt `TcpListener::bind("127.0.0.1:{port}")`. On failure, store error state so frontend can show the port-conflict error (R16). Do not crash the app. Recovery flow: user changes port in global settings → `update_app_settings` command triggers a restart of the hook server on the new port (stop the old axum task if running, spawn a new one).
- Status transitions: accept any valid `SessionStatus` from the hook except `exited` (that comes from process exit only). Return 400 if hook tries to set `exited`.

**Test scenarios:**
- Happy path: POST valid status update → session status updated, event emitted
- Happy path: POST with message → `last_message` field updated
- Error path: POST to unknown session_id → 404 response
- Error path: POST with invalid JSON body → 400 response
- Error path: POST with `status: "exited"` → 400 response (exited is process-lifecycle only)
- Edge case: POST with `message: null` → clears last_message
- Integration: hook POST → frontend receives `session-status-{id}` event with correct payload
- Error path: port already in use → server does not start, error state is set

**Verification:**
- `curl -X POST http://localhost:7837/session/{id}/status -H 'Content-Type: application/json' -d '{"status":"thinking"}'` returns 200 and the frontend session card updates
- Invalid session ID returns 404
- Port conflict is detected and surfaced

---

### Phase 4: Session Identity

- [ ] **Unit 5: Haiku Name Generation and SVG Avatars**

**Goal:** Generate human first names for sessions via Claude CLI (Haiku model), with placeholder fallback and background retry. Generate deterministic geometric SVG avatars from session UUIDs.

**Requirements:** R4

**Dependencies:** Unit 2 (models)

**Files:**
- Create: `src-tauri/src/identity.rs`
- Modify: `src-tauri/src/commands/sessions.rs` (call identity generation on create)
- Create: `src/components/SessionAvatar.tsx`
- Test: `src-tauri/tests/identity.rs`
- Test: `src/components/__tests__/SessionAvatar.test.tsx`

**Approach:**
- **Name generation**: On session creation, spawn the Claude CLI as a child process: `claude -p "Generate a unique human first name for an AI coding agent. Reply with just the name." --model haiku --output-format json`. Parse the JSON output for the name. Run via `tokio::process::Command` (non-blocking). No API key management — Claude Code handles authentication.
- **Fallback**: If CLI call fails (claude not found, timeout after 10s, parse error), assign placeholder name `"Agent-{first_8_chars_of_uuid}"`. Spawn a background retry task that attempts the CLI call again after 5 seconds. On success, update the session name in state and persist. Emit event so frontend updates.
- **No deduplication**: Duplicate names across sessions are cosmetically imperfect but not functionally broken — sessions are keyed by UUID, and the card UI shows both name and task label to disambiguate.
- **Avatar generation**: Derive from UUID in the frontend (pure function, no backend needed). Map UUID bytes to: shape (circle, triangle, square, pentagon, hexagon, diamond — 6 options), fill color (from a curated palette of 12–16 visually distinct colors), and rotation. Render as inline SVG. Small size (~24px for cards, ~16px for picker stack).
- Avatar is deterministic: same UUID always produces the same visual.

**Patterns to follow:**
- `tokio::process::Command` for async subprocess execution
- Identicon/dicebear pattern for deterministic avatar hashing

**Test scenarios:**
- Happy path: Claude CLI returns a valid name → session gets that name
- Error path: `claude` binary not found → session gets placeholder "Agent-{short_id}", retry is scheduled
- Error path: CLI call times out (>10s) → same fallback behavior
- Happy path: background retry succeeds → session name updates from placeholder to real name
- Happy path: avatar component renders an SVG element with correct shape and color for a given UUID
- Edge case: avatar determinism — same UUID input always renders identical SVG

**Verification:**
- Sessions get human first names when Claude CLI is available
- Sessions get placeholder names that update asynchronously when CLI is temporarily unavailable
- Avatars are visually distinct at small sizes
- Names persist across app restarts (stored in session model)

---

### Phase 5: Frontend Core

- [ ] **Unit 6: Terminal Component and Session Switching**

**Goal:** Build the xterm.js terminal component with WebGL rendering, bidirectional I/O, session switching with scrollback replay, and the session panel with status indicators.

**Requirements:** R7, R8, R9, R10, R11, R13, R14, R32, R33, R34, R35, R37, R38, R40

**Dependencies:** Unit 3 (PTY engine), Unit 5 (avatars)

**Files:**
- Create: `src/stores/sessionStore.ts`
- Create: `src/components/Terminal.tsx`
- Create: `src/components/SessionPanel.tsx`
- Create: `src/components/SessionCard.tsx`
- Create: `src/components/StatusIndicator.tsx`
- Create: `src/components/NewSessionInput.tsx`
- Create: `src/components/SessionView.tsx`
- Create: `src/hooks/useTerminal.ts`
- Create: `src/hooks/useSessionEvents.ts`
- Test: `src/components/__tests__/StatusIndicator.test.tsx`
- Test: `src/components/__tests__/SessionCard.test.tsx`

**Approach:**
- **Zustand store** (`sessionStore`): holds `sessions` map, `activeSessionId`, actions for `createSession`, `switchSession`, `killSession`, `restartSession`, `updateStatus`
- **Terminal component**: wraps `@xterm/xterm` Terminal instance. On mount: create terminal, load WebGL addon (with DOM fallback), load fit addon. On active session change: dispose old terminal listeners, call `get_scrollback` → write to terminal, then subscribe to `Channel` for live output. On input: call `send_input`. On resize: call `resize_pty` via fit addon's `proposeDimensions()`.
- **Session switching flow**: (1) store current active session ID, (2) create fresh Terminal or clear existing, (3) invoke `get_scrollback(newSessionId)` → `terminal.write(new Uint8Array(data))`, (4) set up new Channel for live output, (5) invoke `start_output_stream(newSessionId, channel)` (a command that starts forwarding PTY output to this channel)
- **Session panel**: fixed ~280px right column. Lists session cards in creation order. "+ New Session" button at bottom reveals inline slug input. Active session highlighted.
- **Session card**: avatar + name + status dot on first line, task label below. Active card also shows last status message. Click to switch.
- **Status indicator**: React component mapping status enum to color/animation. `running` = green pulse (CSS animation), `thinking` = amber pulse, `waiting` = blue static, `done` = grey static, `error` = red static, `exited` = dark grey static.
- **New session input**: inline text field at bottom of session list. Validates slug format (lowercase, hyphens only). Enter to create. Escape to cancel.
- **Empty state**: when no sessions exist, terminal area shows centered prompt text.
- **Event listeners**: listen for `session-status-{id}` events to update Zustand store. Listen for `session-exited-{id}` to update status.

**Technical design:**

> *Directional guidance — session switching sequence:*

```
User clicks session card (or Cmd+N)
  → sessionStore.switchSession(newId)
  → Terminal component detects activeSessionId change
  → Cleanup: unsubscribe from old Channel
  → terminal.reset()
  → Create new Channel<Vec<u8>>, set onmessage → terminal.write(Uint8Array)
  → scrollback = await invoke('subscribe_output', { sessionId: newId, onOutput: channel })
    (atomic: returns scrollback snapshot AND subscribes channel in one call)
  → terminal.write(new Uint8Array(scrollback))
  → Terminal is now live with new session
```

**Patterns to follow:**
- Zustand v5: `import { create } from 'zustand'`, `useShallow` for multi-property selectors
- xterm.js v6: `@xterm/xterm`, `@xterm/addon-webgl`, `@xterm/addon-fit`

**Test scenarios:**
- Happy path: StatusIndicator renders correct color and animation class for each of the 6 statuses
- Happy path: SessionCard renders avatar, name, task, and status correctly
- Happy path: SessionCard for active session shows last status message
- Happy path: SessionCard for inactive session hides last status message
- Edge case: new session input rejects invalid slug ("Fix Bug", "has spaces", "UPPER") and accepts valid slug ("fix-bug", "a", "my-task-123")
- Edge case: empty state renders when no sessions exist
- Integration: switching sessions triggers scrollback load and channel subscription (mock Tauri invoke)

**Verification:**
- Terminal renders PTY output in real time
- Typing in the terminal sends input to the PTY
- Switching sessions shows the target session's scrollback, then live output
- Status indicators animate/display correctly for all 6 states
- New session creation works via inline input

---

- [ ] **Unit 7: Project Picker, Settings, and Navigation**

**Goal:** Build the Project Picker home screen, global and project settings, file picker integration, and single-window navigation between views.

**Requirements:** R19, R20, R21, R22, R23, R27, R30, R31, R42, R43

**Dependencies:** Unit 2 (project CRUD), Unit 5 (avatars for project cards), Unit 6 (session view exists to navigate to)

**Files:**
- Create: `src/stores/appStore.ts`
- Create: `src/components/ProjectPicker.tsx`
- Create: `src/components/ProjectCard.tsx`
- Create: `src/components/AvatarStack.tsx`
- Create: `src/components/Settings.tsx`
- Create: `src/components/ProjectSettings.tsx`
- Create: `src/components/CommandTemplateInput.tsx`
- Create: `src/hooks/useProjects.ts`
- Modify: `src/App.tsx` (routing between views)
- Test: `src/components/__tests__/CommandTemplateInput.test.tsx`
- Test: `src/components/__tests__/ProjectCard.test.tsx`

**Approach:**
- **App routing**: Simple state-based routing in App.tsx. Three views: `picker`, `session-view`, `settings`. No React Router needed — just conditional rendering based on Zustand app store state.
- **App store** (`appStore`): holds `currentView`, `activeProjectId`, navigation actions
- **Project Picker**: centered card-based list. Each card: project name (from dirname), full path, active session count, avatar stack of active sessions. Click → navigate to Session View. "+ Add Project" button → Tauri file dialog (`@tauri-apps/plugin-dialog`) → on selection, immediately open project settings sheet for command template config.
- **Avatar stack**: overlapping small avatars (like GitHub contributor stacks). Show up to 5, then "+N" badge.
- **Project settings sheet**: modal/sheet overlay. Command template text input with placeholder reference below (`{{session_name}}`, `{{task}}`, `{{project_dir}}`). Live preview showing resolved command with sample values (e.g., session_name="quiet-ember", task="example-task", project_dir="/path/to/project"). Validation: non-empty. Save button.
- **Settings screen**: full-screen view. Hook server port input (number), terminal font size input (number), theme selector (light/dark/system). Save applies to app settings via Tauri command.
- **Remove project**: context action on project card. If project has active sessions, show confirmation dialog. On confirm, invoke `remove_project` which kills all sessions.
- **Back button**: in Session View header, navigates back to Project Picker view in the same window.

**Patterns to follow:**
- `@tauri-apps/plugin-dialog` for native file/directory picker
- Zustand for view state management

**Test scenarios:**
- Happy path: CommandTemplateInput shows live preview with sample placeholder values
- Edge case: CommandTemplateInput with empty template shows validation error
- Edge case: CommandTemplateInput with unknown placeholder (e.g. `{{foo}}`) passes through verbatim in preview
- Happy path: ProjectCard displays project name, path, session count, and avatar stack
- Happy path: ProjectCard with 0 active sessions shows count but no avatar stack
- Edge case: ProjectCard with >5 active sessions shows 5 avatars + "+N" badge
- Integration: add project flow — file picker → settings sheet → project appears in list (mock Tauri)

**Verification:**
- Project Picker lists all registered projects with correct metadata
- Adding a project via file picker opens settings, saves template, and shows the project
- Navigating to a project shows Session View; back button returns to picker
- Settings screen saves and persists configuration changes
- Project removal with active sessions shows confirmation

---

### Phase 6: Multi-Window and Polish

- [ ] **Unit 8: Multi-Window, Dock Lifecycle, Keyboard Shortcuts, and Process Cleanup**

**Goal:** Implement per-project OS windows, macOS dock lifecycle (keep alive, reopen picker), back-button navigation creating duplicate pickers, and Cmd+1–9 keyboard shortcuts.

**Requirements:** R24, R25, R26, R36, R42, R43, R44

**Dependencies:** Unit 6, Unit 7 (both views must exist)

**Files:**
- Create: `src-tauri/src/cleanup.rs`
- Create: `src-tauri/src/commands/windows.rs` (window creation commands + helpers called by RunEvent handlers)
- Modify: `src-tauri/src/lib.rs` (RunEvent handlers)
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src/hooks/useTerminal.ts` (key handler for Cmd+1-9)
- Modify: `src/App.tsx` (window-aware routing — read window label to determine initial view)
- Test: `src-tauri/tests/cleanup.rs`

**Approach:**
- **Window creation**: Tauri command `open_project_window(project_id)` creates `WebviewWindowBuilder::new(&app, format!("project-{}", project_id), ...)`. If window with that label already exists, focus it instead. Pass project_id as a URL query parameter or Tauri event so the frontend knows which project to display.
- **Window-aware routing**: `App.tsx` reads the current window label. If label is `picker` or `main`, show Project Picker. If label starts with `project-`, extract project ID and show Session View for that project.
- **Back button behavior (R42)**: Navigating back from Session View re-renders the Project Picker in the same window via React view state change. The window label remains `project-{id}` but renders the picker. From this picker state: clicking the *same* project just switches the view back to Session View (same window, no new window). Clicking a *different* project opens a new `project-{new_id}` window.
- **Dock lifecycle (R44)**:
  - `RunEvent::ExitRequested` with `code.is_none()` → `api.prevent_exit()` (keeps app alive when all windows closed)
  - `RunEvent::Reopen` with `!has_visible_windows` → create new picker window
  - `RunEvent::Exit` → run process cleanup
- **App launch (R43)**: Single picker window created in setup hook. No window state restoration.
- **Keyboard shortcuts (R36)**: `attachCustomKeyEventHandler(ev)` on the xterm.js terminal. Intercept `Cmd+1` through `Cmd+9` (check `ev.metaKey && ev.key >= '1' && ev.key <= '9'`). Return `false` to prevent xterm.js from processing the key. Call `sessionStore.switchToIndex(n - 1)` which maps to sessions in creation order.
- **Process cleanup (R44, R1, R6)**:
  - `RunEvent::Exit`: iterate all session handles, `killpg(pid, SIGHUP)`, sleep 500ms, `killpg(pid, SIGKILL)`
  - PID persistence: session JSON includes `last_known_pid`. On next launch, check for orphaned processes and kill them.
  - `signal-hook`: catch SIGTERM/SIGINT, kill all tracked PIDs, exit.
- **Event routing**: status updates from hook server → `emit_to(format!("project-{}", project_id), ...)` for the specific project window. Also `emit("session-count-changed", ...)` broadcast for any open pickers.

**Execution note:** Start with single-window behavior working, then add multi-window. Test dock lifecycle manually on macOS.

**Patterns to follow:**
- Tauri `RunEvent::ExitRequested` / `RunEvent::Reopen` pattern from research
- xterm.js `attachCustomKeyEventHandler` for shortcut interception

**Test scenarios:**
- Happy path: cleanup module — given a list of PIDs, sends SIGHUP then SIGKILL after grace period
- Happy path: orphan detection — given persisted PIDs, identifies which are still running
- Edge case: orphan cleanup — PID no longer running → skip gracefully (no error)
- Happy path: Cmd+1 through Cmd+9 key interception — verify handler returns false for meta+digit combinations
- Edge case: Cmd+0 or Cmd+non-digit — handler returns true (pass through to xterm.js)
- Integration: opening a second project creates a new window with the correct project loaded

**Verification:**
- Opening two projects results in two OS windows
- Closing all windows keeps the app alive in the dock
- Clicking the dock icon reopens the Project Picker
- Cmd+Q kills all sessions and exits
- Cmd+1-9 switches between sessions
- App restart cleans up orphaned processes from previous run

## System-Wide Impact

- **Interaction graph**: PTY reader thread → mpsc → async forwarder → Tauri Channel → xterm.js. Hook server → state update → Tauri event → Zustand store → React re-render. Process exit watcher → state update → Tauri event → frontend status update. Three independent data paths that all converge on the shared `AppState`.
- **Error propagation**: PTY spawn failures surface as immediate process exit (R39). Hook server port conflicts surface as startup error state. JSON persistence failures should log and continue (non-fatal). Channel send failures indicate the frontend disconnected (window closed) — stop the forwarder task gracefully.
- **State lifecycle risks**: Scrollback buffer grows unbounded without the byte cap — the 8MB limit is essential. Multiple windows can race on state mutations — `RwLock` with short critical sections mitigates this. Atomic persistence write prevents corrupt JSON on crash.
- **API surface parity**: All session management is backend-first (Tauri commands). The frontend is a pure consumer. No duplicate logic.
- **Integration coverage**: The PTY → Channel → xterm.js pipeline must be tested end-to-end (not just unit mocked). The hook → event → status update pipeline must be tested with a real HTTP POST.
- **Unchanged invariants**: The app never writes to the user's project directories. It never installs or modifies hook scripts. It never auto-discovers or interferes with existing terminal sessions.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `portable-pty` blocking reads stall tokio runtime | Dedicated OS threads, not `spawn_blocking`. Validated pattern from WezTerm. |
| Tauri `Channel<Vec<u8>>` JSON serialization overhead for terminal output | Output batching (8ms/200KB) keeps individual sends small. Acceptable for terminal volumes. Profile and switch to custom protocol if needed. |
| WebGL context limit (~16) with many sessions | Only the active session needs WebGL. Dispose addon when switching sessions; re-create on activation. Fall back to DOM if context creation fails. |
| Orphaned agent processes on app crash | Multi-layer cleanup: `RunEvent::Exit`, `signal-hook`, PID persistence for next-launch recovery. |
| `RunEvent::ExitRequested` `code.is_none()` workaround for macOS dock behavior | Known pattern but not first-class Tauri API (issue #13511 open). Works reliably in current versions. Monitor for API changes. |
| xterm.js v6 scrollback replay flicker | Accept for v1. Mitigate by writing full buffer in one `terminal.write()` call. Investigate DEC private mode 2026 during implementation. |
| axum 0.8.x path syntax change (`{param}` not `:param`) | Noted in plan. Implementer must use new syntax. |

## Documentation / Operational Notes

- README should document: how to configure agent hooks to POST to Séance, the `SEANCE_*` environment variables available to spawned processes, an example hook script for Claude Code
- No deployment or CI needed for v1 — desktop app distributed as a macOS `.app` bundle via `cargo tauri build`

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-05-seance-v1-requirements.md](docs/brainstorms/2026-04-05-seance-v1-requirements.md)
- **Stack documentation:** [docs/research/2026-04-05-stack-documentation.md](docs/research/2026-04-05-stack-documentation.md)
- Tauri v2 docs: https://v2.tauri.app
- portable-pty: https://docs.rs/portable-pty
- xterm.js v6: https://xtermjs.org
- WezTerm PTY architecture: https://deepwiki.com/wezterm/wezterm/4.5-pty-and-process-management
- Hyper terminal batching PR: https://github.com/vercel/hyper/pull/3336
- axum 0.8 changelog (path syntax): https://github.com/tokio-rs/axum/blob/main/axum/CHANGELOG.md
