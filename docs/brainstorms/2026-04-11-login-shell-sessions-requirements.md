---
date: 2026-04-11
topic: login-shell-sessions
---

# Login Shell Sessions

## Problem Frame

Séance currently spawns sessions as non-interactive, non-login shells (`$SHELL -c "command"`). This means:

- Sessions **require** a command template — you can't create a session without one
- The spawned shell doesn't source login/interactive startup files (`.zshrc`, `.bash_profile`, `.zprofile`, etc.), so the user's aliases, PATH additions, and shell functions are unavailable
- When the command exits, the session is over — no opportunity for follow-up work

This limits Séance to a command launcher rather than a terminal session manager. Users should be able to open a real terminal session with their full environment, optionally with a command kicked off automatically.

## Requirements

**Session Lifecycle**

- R1. Each session spawns the user's shell as an interactive login shell, ensuring all standard startup files are sourced (the shell determines which files — e.g., `.zprofile`/`.zshrc` for zsh, `.bash_profile` for bash)
- R2. When a Command Template is configured, the resolved command plus a trailing newline is written to the shell's stdin after startup, so it executes as if the user typed it
- R3. After a templated command exits, the login shell remains alive and the user returns to their shell prompt
- R4. When no Command Template is configured, the user is dropped directly into their shell prompt

**Session Creation**

- R5. The Command Template is no longer required to create a session — sessions with an empty template are valid (currently blocked by both backend and frontend validation)
- R6. The task slug remains required for all sessions (it serves as the session label/organizer regardless of whether a command runs)

**Session Restart**

- R7. Restarting a session re-resolves the project's current Command Template and applies the same login-shell behavior (template present → inject command; template empty → bare shell)

## Success Criteria

- A session created without a command template drops the user into a fully functional login shell with their normal environment (aliases, PATH, prompt, etc.)
- A session created with a command template starts the shell, runs the command, and returns to the shell prompt when the command finishes
- Existing command template features (placeholders, escaping, per-project configuration) continue to work unchanged

## Scope Boundaries

- No changes to the Command Template placeholder system or resolution logic
- No changes to session metadata, persistence, or the hook system
- No new settings for shell type or login behavior — login shell is the default and only mode
- Frontend validation changes in `ProjectSettings.tsx` are in scope (removing the empty-template guard on the save button)
- Command invocation changes from `-c` argument to stdin injection — the template resolution itself is unchanged, only the delivery mechanism

## Key Decisions

- **Login shell stays alive after command**: The shell persists after the templated command exits, giving users the ability to inspect results and run follow-up commands. The session ends only when the user exits the shell.
- **Command injection via stdin**: The resolved command is written to the shell's stdin (with trailing `\n`) rather than passed as a `-c` argument. This keeps the shell interactive and makes the command visible in the terminal as if typed.
- **Use `portable_pty`'s `new_default_prog()`**: The crate already provides `CommandBuilder::new_default_prog()` which spawns a login shell via the POSIX-correct `argv[0]` prefix method (e.g., `-zsh`). This is more portable than passing `-l` (which fish rejects) and is how real terminal emulators do it.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] What delay (if any) is needed between shell spawn and writing the command to stdin? The kernel's TTY line discipline buffers canonical-mode input, so immediate writes are likely safe, but extremely slow shell startups (oh-my-zsh, nvm, conda) could create a race where the command executes before the environment is fully loaded.
- [Affects R7][Technical] Verify that `restart_session` correctly handles the template-empty case and that re-resolving at restart-time (current behavior) is still the right default.

## Next Steps

-> `/ce:plan` for structured implementation planning
