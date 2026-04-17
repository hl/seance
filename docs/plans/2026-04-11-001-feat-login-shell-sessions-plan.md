---
title: "feat: Spawn sessions as interactive login shells"
type: feat
status: completed
date: 2026-04-11
origin: docs/brainstorms/2026-04-11-login-shell-sessions-requirements.md
---

# feat: Spawn sessions as interactive login shells

## Overview

Change Séance's session spawning from one-shot `$SHELL -c "command"` to interactive login shells using `portable_pty`'s `CommandBuilder::new_default_prog()`. When a Command Template is configured, the resolved command is written to stdin after spawn. When no template is configured, the user gets a bare shell. The shell stays alive after any command exits.

## Problem Frame

Sessions currently require a command template and run as non-interactive, non-login shells. Users don't get their full environment (aliases, PATH, functions) and can't do follow-up work after a command finishes. This limits Séance to a command launcher instead of a terminal session manager. (see origin: `docs/brainstorms/2026-04-11-login-shell-sessions-requirements.md`)

## Requirements Trace

- R1. Spawn interactive login shell sourcing standard startup files
- R2. Write resolved command + trailing newline to stdin when template is configured
- R3. Shell stays alive after templated command exits
- R4. Bare shell prompt when no template is configured
- R5. Command Template no longer required for session creation
- R6. Task slug remains required
- R7. Restart re-resolves current template, applies same login-shell behavior

## Scope Boundaries

- No changes to the Command Template placeholder system or resolution logic
- No changes to session metadata, persistence, or the hook system
- No new settings — login shell is the only mode
- Frontend validation in `ProjectSettings.tsx` and `CommandTemplateInput.tsx` changes are in scope (removing empty-template blocking)

## Context & Research

### Relevant Code and Patterns

- `src-tauri/src/pty_engine.rs:95-194` — `spawn_session()` function, currently uses `CommandBuilder::new(&shell)` with `-c` flag
- `src-tauri/src/commands/sessions.rs:57-141` — `create_session`, empty-template guard at line 74
- `src-tauri/src/commands/sessions.rs:323-435` — `restart_session`, empty-template guard at line 353
- `src/components/ProjectSettings.tsx:57,123` — frontend save guard and disabled button
- `src/components/CommandTemplateInput.tsx:40,61-71` — empty-state visual error
- `src-tauri/tests/integration.rs` — extensive integration tests with `make_project()`, `make_session()`, `new_state()` helpers
- `portable_pty` v0.9 `CommandBuilder::new_default_prog()` — spawns login shell via `argv[0]` prefix (`-zsh`, `-bash`). Supports `env()` and `cwd()` but panics on `arg()`.

### Institutional Learnings

- **PTY reader threading**: Use `std::thread::spawn` with dedicated OS threads, bridged to async via `tokio::sync::mpsc` (already in place, no change needed)
- **IPC field naming**: Tauri v2 does not auto-convert snake_case/camelCase — match field names exactly when modifying commands
- **E2E test types**: Update `e2e/types/backend.ts` if command signatures change

## Key Technical Decisions

- **`new_default_prog()` over `-l` flag**: `portable_pty` already provides the POSIX-correct login shell mechanism via `argv[0]` prefix. This works across bash, zsh, fish, and sh. The `-l` flag would fail on fish (`--login` required). Using `new_default_prog()` means we cannot pass any args (it panics), which is exactly what we want — the shell runs interactively with no `-c` argument. (see origin: Key Decisions)
- **Immediate stdin write, no delay**: The PTY kernel's line discipline buffers canonical-mode input. Data written to the master writer is held in the kernel buffer until the shell issues its first `read()` after completing init files. No artificial delay is needed. The command will appear at the prompt naturally after the shell finishes sourcing startup files.
- **Restart re-resolves from current project template**: This is the existing behavior and remains correct. If a user clears their template after creating a session, restarting that session gives them a bare shell. If they set a new template, restart runs the new command. This is intuitive.

## Open Questions

### Resolved During Planning

- **Stdin write timing**: No delay needed. The PTY kernel buffer holds the data until the shell reads. Verified from `portable_pty` source — `spawn_command()` wires child stdin to the slave PTY fd, and the master writer delivers directly to that buffer.
- **Newline appending**: Always append `\n`. All shells in interactive mode require a newline to execute a buffered command. Without it, the command sits in the buffer indefinitely.
- **`new_default_prog()` compatibility**: Confirmed from source — `as_command()` resolves the shell via `get_shell()` (checks `$SHELL`, falls back to password database), then sets `argv[0]` to `-basename`. Works universally.
- **Restart behavior**: Re-resolves from current project template. Same generated_name and task are preserved. Base commit is re-resolved from session working directory.

### Deferred to Implementation

- Exact behavior when `new_default_prog()` can't find a valid shell (fallback to `/bin/sh` is built into `portable_pty` — verify this produces a usable login shell)

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
BEFORE:  $SHELL -c "resolved_command"
         └─ non-interactive, non-login
         └─ exits when command exits
         └─ requires non-empty template

AFTER:   $SHELL (as login shell via argv[0] = "-zsh")
         └─ interactive login shell
         └─ sources .zprofile, .zshrc, etc.
         ├─ IF template: write "resolved_command\n" to stdin
         │   └─ command runs, shell stays alive after it exits
         └─ IF no template: user gets bare shell prompt
```

The change is localized to `spawn_session()` (how the shell is invoked), `create_session`/`restart_session` (removing the template requirement), and frontend validation (allowing empty templates to be saved).

## Implementation Units

- [x] **Unit 1: Change `spawn_session()` to use login shell with optional command**

  **Goal:** Replace `CommandBuilder::new(&shell)` + `-c` with `new_default_prog()`, accept optional command, write to stdin when provided.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Modify: `src-tauri/src/pty_engine.rs`
  - Test: `src-tauri/tests/integration.rs`

  **Approach:**
  - Change `spawn_session` signature: `command_line: &str` becomes `command_line: Option<&str>`
  - Replace `CommandBuilder::new(&shell)` + `cmd.arg("-c")` + `cmd.arg(command_line)` with `CommandBuilder::new_default_prog()`
  - Keep all existing `cmd.env()` and `cmd.cwd()` calls — these work on `new_default_prog()` builders
  - After `take_writer()`, if `command_line` is `Some(cmd)` and `cmd` is not empty, write `format!("{}\n", cmd)` to the writer before wrapping it in `Arc<Mutex<>>`. Treat `Some("")` the same as `None`.
  - If the stdin write fails, propagate the error from `spawn_session()` — the child is likely already dead if the PTY write fails, so failing session creation is the correct behavior
  - The writer write happens synchronously in `spawn_session()` before returning the handle — no need for delayed or async injection

  **Patterns to follow:**
  - Current env/cwd setup pattern at `pty_engine.rs:119-130`
  - Writer usage pattern at `pty_engine.rs:148-153`

  **Test scenarios:**
  - Happy path: spawn with `Some("echo hello")` — child process starts, writer is available, session handle is valid
  - Happy path: spawn with `None` — child process starts as login shell, no command injected, session handle is valid
  - Edge case: spawn with `Some("")` — treated same as `None` (empty string should not write to stdin)
  - Integration: verify that env vars (`TERM`, `COLORTERM`, `SEANCE_SESSION_ID`, `SEANCE_HOOK_PORT`, `SEANCE_HOOK_TOKEN`, `SEANCE_HOOK_URL`) are set on the login shell just as they were on the `-c` shell

  **Verification:**
  - `cargo test` passes
  - A session with a command template spawns, runs the command, and the shell remains alive
  - A session without a command template spawns directly to a shell prompt with the user's full environment

- [x] **Unit 2: Remove empty-template guards in session commands**

  **Goal:** Allow `create_session` and `restart_session` to proceed when the command template is empty.

  **Requirements:** R5, R6, R7

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `src-tauri/src/commands/sessions.rs`
  - Test: `src-tauri/tests/integration.rs`

  **Approach:**
  - In `create_session`: remove the guard at line 74-76 (`if command_template.is_empty() { return Err(...) }`)
  - Replace the unconditional `resolve_template()` call with a conditional: only call `resolve_template()` when the template is non-empty, producing `Some(&command_line)`; when the template is empty, pass `None` to `spawn_session` (skip resolution entirely)
  - In `restart_session`: remove the guard at line 353-355, apply the same conditional resolution pattern
  - The task slug validation (`validate_task_slug`) remains unchanged — task is always required

  **Patterns to follow:**
  - Existing `resolve_template()` call at `sessions.rs:83-84`
  - Existing `restart_session` template resolution at `sessions.rs:358-359`

  **Test scenarios:**
  - Happy path: `create_session` with non-empty template — resolves template, passes `Some(command)` to spawn, session created with status Running
  - Happy path: `create_session` with empty template — skips resolution, passes `None` to spawn, session created with status Running
  - Happy path: `restart_session` with non-empty template — re-resolves template, spawns with command, preserves session identity
  - Happy path: `restart_session` with empty template — spawns bare shell, preserves session identity
  - Edge case: project template changed between create and restart — restart uses the new template
  - Error path: `create_session` with empty task slug — still rejected by `validate_task_slug`

  **Verification:**
  - `cargo test` passes
  - Sessions can be created and restarted with or without a command template
  - Task slug validation is unaffected

- [x] **Unit 3: Update frontend validation to allow empty templates**

  **Goal:** Remove the UI blocks that prevent saving an empty command template.

  **Requirements:** R5

  **Dependencies:** Unit 2 (backend must accept empty templates before frontend allows them)

  **Files:**
  - Modify: `src/components/ProjectSettings.tsx`
  - Modify: `src/components/CommandTemplateInput.tsx`
  - Test: `src/components/__tests__/CommandTemplateInput.test.tsx` (new)

  **Approach:**
  - In `ProjectSettings.tsx`: remove the `commandTemplate.trim() === ""` early return in `handleSave` (line 57) and remove the empty-template condition from the `disabled` prop (line 123)
  - In `CommandTemplateInput.tsx`: remove the red border styling and "Command template cannot be empty" error message for empty state (lines 61-71). The empty state is now valid — the input should look normal when empty. Keep the preview hidden when empty (line 94-101) since there's nothing to preview.

  **Patterns to follow:**
  - Existing `CommandTemplateInput` component structure
  - Existing save flow in `ProjectSettings.tsx`

  **Test scenarios:**
  - Happy path: saving with a non-empty template — still works as before
  - Happy path: saving with an empty template — save proceeds, no error styling, no early return
  - Happy path: CommandTemplateInput with empty value — no red border, no error message
  - Edge case: CommandTemplateInput with whitespace-only value — treated as empty (no error, no preview)

  **Verification:**
  - `npm run test` passes
  - The save button is enabled with an empty template field
  - No visual error indicators appear for empty templates

## System-Wide Impact

- **Interaction graph:** `spawn_session()` is called by `create_session` and `restart_session` only. The signature change is contained to these two callers. The `SessionHandle` struct and all downstream consumers (exit watcher, `subscribe_output`, `send_input`, `kill_session`, `resize_pty`) are unaffected.
- **Error propagation:** The removed guards (`"Project has no command template configured"`) were the only place this error surfaced. Frontend code in `sessionStore.ts` handles backend errors generically — no error-specific handling to update.
- **State lifecycle risks:** `SessionStatus` no longer reflects command completion — only shell lifetime. Previously, session exit meant the command finished. Now, the session stays `Running` after the injected command exits and only transitions to `Exited` when the user closes the shell (`exit`, Ctrl-D, or `kill_session`). No existing code depends on "session exit = command finished" but this is a semantic shift worth noting. The `Session` model and persistence format are unchanged. Old sessions with command templates will restart correctly under the new code.
- **API surface parity:** The `create_session` and `restart_session` Tauri commands keep the same parameter signatures. Only internal behavior changes (empty template is now accepted).
- **Unchanged invariants:** Task slug validation, session identity (UUID + generated name), hook system environment injection, scrollback buffer management, exit watcher lifecycle, process cleanup — all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Slow shell startup (oh-my-zsh, nvm, conda) delays command execution | PTY kernel buffer holds the command safely. The user sees their shell initializing before the command runs — this is expected behavior, same as any terminal emulator. |
| `new_default_prog()` panics if `arg()` is accidentally called | Remove all `cmd.arg()` calls from the login shell path. The compiler won't catch this at build time, but integration tests will catch it at runtime. |
| PTY buffer size limit (~4KB on macOS) blocks synchronous write for very large commands | Resolved commands from templates are typically well under 1KB. Accept the risk as negligible for real-world use. If a future template expansion creates multi-KB commands, the write would block until the shell starts reading — not a deadlock, just a startup delay. |
| Command echo visibility differs from `-c` mode | Expected and desirable — the user can see what command was injected. Document this as intentional behavior. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-11-login-shell-sessions-requirements.md](docs/brainstorms/2026-04-11-login-shell-sessions-requirements.md)
- Related code: `portable_pty` v0.9 `CommandBuilder` source (`cmdbuilder.rs`)
- Institutional learning: `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md`
- Institutional learning: `docs/solutions/integration-issues/tauri-frontend-backend-field-naming-mismatches-2026-04-05.md`
