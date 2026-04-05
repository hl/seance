---
date: 2026-04-05
topic: session-creation-ux
---

# Session Creation UX Improvements

## Problem Frame

Creating a new session is slow (PTY spawn + Haiku name generation) and the input doesn't prevent double-submits. Users can press Enter multiple times during the wait, creating duplicate sessions with the same task name. The input also requires a pre-slugified format, adding friction.

## Requirements

- R1. **Double-submit prevention**: Disable the input and show a loading state after the first Enter press. Prevent any further submissions until the backend responds (success or error).
- R2. **Auto-slugify input**: Accept any text the user types (spaces, uppercase, special chars) and auto-convert to a valid slug on submit. "Fix Auth Bug" becomes "fix-auth-bug". Remove the strict slug validation error — just clean the input silently.
- R3. **Unique task names per project**: If a session with the same task slug already exists in the project, auto-append a numeric suffix: "hello-world" → "hello-world-2" → "hello-world-3". No error shown — just deduplicate silently.
- R4. **Loading indicator**: While the session is being created (between Enter and backend response), show a spinner or "Creating..." text in the input area. The "+ New Session" button stays hidden during creation.

## Success Criteria

- Pressing Enter rapidly creates exactly one session
- Typing "Fix Auth Bug!!" creates a session with task "fix-auth-bug"
- Creating two sessions with the same name auto-suffixes the second one

## Scope Boundaries

- No changes to the Rust backend slug validation (keep it as a safety net)
- No changes to session identity generation or PTY spawning speed

## Next Steps

→ Proceed directly to work
