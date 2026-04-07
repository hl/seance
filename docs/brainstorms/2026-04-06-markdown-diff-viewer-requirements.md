---
date: 2026-04-06
topic: markdown-diff-viewer
---

# Markdown Browser & Diff Viewer

## Problem Frame

When monitoring AI agent sessions in Séance, users can only see raw terminal output via xterm.js. To see rendered documentation the agent is writing or review code changes, they must leave the app and open an editor or IDE. This breaks the orchestration flow — especially when running multiple agents — and makes it hard to quickly assess what an agent is producing.

## Requirements

**Session Working Directory**
- R1. The Session model gains a `working_dir` field, defaulting to `project.path` at creation time
- R2. An agent can report a changed working directory via the hook server (e.g., after creating and entering a git worktree), updating the session's `working_dir`
- R3. All file operations (listing markdown files, reading file contents, running git commands) use the session's `working_dir` as their root — not a hardcoded project path
- R4. No assumption is made that `working_dir` is a top-level git checkout — it may be a worktree, a subdirectory, or a non-git directory

**Tab Navigation**
- R5. The session view replaces the standalone terminal with a tabbed interface containing three tabs: Terminal, Markdown, Diff
- R6. Terminal tab is the default when a session is opened or created
- R7. Tab selection is per-session (in-memory, not persisted) — switching between sessions preserves each session's last-active tab
- R8. The existing terminal continues to function identically within its tab — kept always-mounted via CSS visibility toggling (matching the existing `display:none/block` pattern) to avoid xterm.js remount and scrollback replay
- R9. Keyboard shortcuts switch tabs (Cmd+Shift+1/2/3) even when the terminal has focus — Cmd+1-9 remains reserved for session switching. Switching tabs moves focus to the new tab's primary content area (Terminal → xterm canvas, Markdown → file list sidebar, Diff → file list header)

**Markdown Browser**
- R10. The Markdown tab has a two-panel layout: a file list sidebar on the left (~25% width, collapsible) and a rendered preview panel on the right
- R11. The file list shows `.md` files found recursively in `working_dir`, respecting `.gitignore` rules when in a git repository; in non-git directories, all `.md` files are listed
- R12. Files are displayed as a flat list with relative paths, sorted alphabetically by path
- R13. On first activation with no file selected, the preview panel shows a placeholder: "Select a file to preview"
- R14. Selecting a file renders it as formatted HTML with GitHub-Flavored Markdown support: headings, lists, code blocks with syntax highlighting, links, images, tables, task lists
- R15. If the currently-viewed file is deleted by the agent, the preview shows "File no longer exists" with the filename; the file disappears from the sidebar but no auto-selection occurs
- R16. If the currently-viewed file is renamed and the rename is detected as a move event, the selection follows the new path. If the rename is not detected (e.g., delete + create by the editor), it is treated as a deletion per R15 — "File no longer exists" with the old filename

**Diff Viewer**
- R17. On session spawn (and on restart via `restart_session`), the backend records the current HEAD commit SHA as `base_commit`, replacing any previous value
- R18. The Diff tab shows `git diff <base_commit>` (single-arg form, which diffs the base commit tree against the current working tree) — showing everything the agent has changed since the session started, whether committed or not, in a single command
- R19. Diffs are displayed in unified format with syntax-aware coloring: added lines, removed lines, modified context, and file headers clearly distinguished
- R20. A file list header shows all changed files; selecting a file highlights it in the header and anchor-scrolls to that file's diff section within the continuous view. On first load, the full diff is shown with all files visible and no file highlighted in the header
- R21. Diff tab empty/error states: non-git directory → "Not a git repository"; no changes → "No changes since session start"; git command failure (e.g., unreachable base_commit) → "Diff unavailable: {error}" with a fallback to showing uncommitted changes only

**Refresh Behavior**
- R22. File system changes trigger refresh via the backend (mechanism deferred to planning — watcher or polling), debounced at 500ms to avoid flicker during rapid agent writes
- R23. The file list and rendered preview update in place — the existing list persists until new results arrive (no flash to empty state during refresh)
- R24. The diff re-computes on file system events with the same 500ms debounce; a "last updated: Ns ago" indicator shows when the diff was last computed
- R25. On first activation of the Markdown or Diff tab, a loading skeleton is shown while the backend scans/computes

| Tab | Content | Refresh trigger | Loading state | Empty state |
|---|---|---|---|---|
| Terminal | xterm.js PTY stream | Live (existing) | N/A | "No output yet" (existing) |
| Markdown | File list + rendered preview | FS events, 500ms debounce | Skeleton | "No markdown files found" / "Select a file to preview" |
| Diff | Session diff + file list | FS events, 500ms debounce | Skeleton | "No changes since session start" / "Not a git repository" |

## Success Criteria

- User can read agent-generated markdown docs rendered in-app without switching to an editor
- User can see a cumulative summary of all file changes the agent has made since the session started, including committed changes
- Tabs stay mounted in the DOM — switching between them is instant with no re-render or data refetch
- Works correctly whether the session is in a standard checkout, a git worktree, or a non-git directory

## Scope Boundaries

- Read-only — no file editing, staging, committing, or git operations from the UI
- No commit history browser or log viewer — only the cumulative session diff
- No preview for non-markdown files outside of the diff view
- No full project file tree — only `.md` files in the Markdown tab
- No search within markdown or diff content (can be added later)
- `working_dir` updates only via hook server — no runtime CWD detection from the process

## Key Decisions

- **Tabbed interface with terminal as a tab**: Maximizes screen space for each view. Terminal, Markdown, and Diff are peers, not layered panels. Terminal stays always-mounted via CSS to avoid xterm.js remount cost.
- **Per-session working directory**: Sessions gain a `working_dir` field (defaulting to `project.path`) so each session can point at a different worktree or subdirectory. Updated via hook server, not runtime process inspection.
- **Diff since session start**: Records HEAD SHA at spawn time and diffs against it. Always answers "what has the agent changed?" even when the agent commits frequently. Simpler than working tree diff which resets to empty on each commit.
- **Markdown-only file browser**: Keeps the browser focused and simple. Code files are already visible in the diff view. A full file tree can be added later if needed.
- **.gitignore-aware file listing**: Prevents the markdown file list from being flooded with dependency READMEs (e.g., hundreds of .md files in node_modules).
- **Anchor-scroll for diff navigation**: Selecting a changed file scrolls to its section in the continuous diff view. Simpler than filter-mode and preserves surrounding context.

## Dependencies / Assumptions

- The Session model needs a new `working_dir` field and the hook server needs a new endpoint to update it — this is new plumbing
- The Session model needs a new `base_commit` field (persisted, `Option<String>`, serde default `None`) recorded at spawn time — follows the existing pattern for `exit_code` and `exited_at`
- Git is assumed to be available on the system PATH (Séance targets developer machines); git binary absence is undefined behavior and out of scope
- In non-git directories, `base_commit` is null and the Diff tab shows its empty state

## Outstanding Questions

### Deferred to Planning
- [Affects R22, R24][Technical] What refresh mechanism to use — file system watcher (e.g., `notify` crate) vs polling? Both share one backend mechanism serving R22 and R24. Watchers are more responsive but add complexity; polling is simpler but may miss rapid changes.
- [Affects R14][Needs research] Which markdown rendering library to use on the frontend (react-markdown, marked, markdown-it) and whether GFM + syntax highlighting support is built-in or requires plugins.
- [Affects R19][Needs research] Whether to render diffs on the frontend (parse unified diff output) or use a Rust diff library and send structured data. Frontend parsing is simpler; Rust-side diffing could enable richer features later.
- [Affects R11][Technical] How `.gitignore` resolution works when `working_dir` is a subdirectory of a git repo (not the root) or a git worktree. Git's native ignore resolution handles this, but the listing mechanism must account for it.
- [Affects R10][Technical] Sidebar collapse affordance details (toggle control, collapsed width, state persistence) — can be resolved during implementation.

## Next Steps

→ `/ce:plan` for structured implementation planning
