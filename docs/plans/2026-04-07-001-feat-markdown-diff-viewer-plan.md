---
title: "feat: Add markdown browser and diff viewer to session view"
type: feat
status: active
date: 2026-04-07
origin: docs/brainstorms/2026-04-06-markdown-diff-viewer-requirements.md
---

# feat: Add markdown browser and diff viewer to session view

## Overview

Add a tabbed interface to the session view with three tabs — Terminal, Markdown, and Diff — so users can monitor what AI agents are producing without leaving Séance. The Terminal tab preserves the existing xterm.js experience. The Markdown tab renders `.md` files from the session's working directory. The Diff tab shows a cumulative diff of everything the agent has changed since the session started.

This also introduces a per-session `working_dir` field and a `base_commit` field, enabling sessions to point at different worktrees and track their diff baseline.

## Problem Frame

Users monitoring AI agent sessions in Séance can only see raw terminal output. To review rendered documentation or code changes, they must leave the app. This breaks the orchestration flow, especially when running multiple agents. (see origin: `docs/brainstorms/2026-04-06-markdown-diff-viewer-requirements.md`)

## Requirements Trace

- R1-R4: Per-session `working_dir` with hook server updates
- R5-R9: Tabbed interface with keyboard shortcuts
- R10-R16: Markdown browser with file list, GFM rendering, live refresh
- R17-R21: Diff viewer with session-start baseline, unified format, error states
- R22-R25: Refresh behavior with debounce, loading/empty states

## Scope Boundaries

- Read-only — no editing, staging, committing from the UI
- No commit history browser — only cumulative session diff
- No non-markdown file preview outside diff view
- No search within markdown or diff content
- `working_dir` updates only via hook server — no runtime CWD detection
- (see origin for full list)

## Context & Research

### Relevant Code and Patterns

- **Session model**: `src-tauri/src/models.rs` — `#[serde(default, skip_serializing_if = "Option::is_none")]` pattern for new Optional fields (see `exit_code`, `exited_at`)
- **Session creation**: `src-tauri/src/commands/sessions.rs:36-114` — struct literal at line 80 is where `working_dir` and `base_commit` are injected
- **Session restart**: `src-tauri/src/commands/sessions.rs:282-372` — metadata update at line 345 is where `base_commit` is re-recorded
- **Hook server**: `src-tauri/src/hook_server.rs` — single route pattern, `HookState` shared state, event emission at lines 110-120
- **Terminal visibility**: `src/components/Terminal.tsx:95` — `display:none/block` pattern for always-mounted terminal
- **SessionView layout**: `src/components/SessionView.tsx` — `<TerminalView />` + `<SessionPanel />` flex layout
- **Key bindings**: `src/hooks/useTerminal.ts:93-104` — `Cmd+1-9` interception via `attachCustomKeyEventHandler`
- **State management**: `src/stores/sessionStore.ts` — Map-based Zustand store, `backendToFrontend` conversion at line 40
- **Event patterns**: `src/hooks/useSessionEvents.ts` — per-session event subscription with `listen()`
- **Type mirroring**: `e2e/types/backend.ts` — must stay in sync with Rust models

### Institutional Learnings

- **Tauri IPC naming**: snake_case in TypeScript must match Rust serde serialization exactly — no auto-conversion (from `docs/solutions/integration-issues/tauri-frontend-backend-field-naming-mismatches-2026-04-05.md`)
- **Mock backend sync**: When Rust structs change, update `e2e/types/backend.ts` and `e2e/helpers/mock-backend.ts` in lockstep (from `docs/solutions/best-practices/typed-mock-backend-for-tauri-e2e-tests-2026-04-05.md`)
- **Keyboard shortcuts**: Use `attachCustomKeyEventHandler()` — do NOT use Tauri global shortcuts (double-fire on macOS) (from `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md`)
- **Cmd+Shift key caveat**: On macOS, `Cmd+Shift+1` produces `ev.key === "!"`, not `"1"`. Must check `ev.code` (`Digit1`, `Digit2`, `Digit3`) when both `metaKey` and `shiftKey` are true.

## Key Technical Decisions

- **Frontend polling over file watching**: The frontend polls backend commands at ~2s intervals when the Markdown or Diff tab is active. No `notify` crate, no file watcher lifecycle management, no macOS FSEvents quirks. The 500ms debounce requirement is satisfied by a minimum interval between fetches. Polling stops when the tab is inactive or the session is not active. This is dramatically simpler for v1 and can be upgraded to a watcher later if the latency matters.

- **Git CLI over git2 crate**: Shell out to `git` via `std::process::Command` for `ls-files`, `diff`, `rev-parse`. Matches the existing assumption that git is on PATH. Avoids the `git2`/`libgit2` dependency and its build complexity.

- **react-markdown + remark-gfm + rehype-highlight for markdown**: Standard React markdown stack. `react-markdown` renders markdown to React elements, `remark-gfm` adds GFM support (tables, task lists, strikethrough), `rehype-highlight` adds syntax highlighting to code blocks via `highlight.js`. Established, well-maintained, tree-shakeable.

- **diff2html for diff rendering**: Takes unified diff text (stdout of `git diff`) and renders it as colored HTML. Supports unified and side-by-side views. No need to parse diff format ourselves.

- **`working_dir` as `String` (not `Option<String>`)**: Always set — defaults to `project.path` at creation. Uses `#[serde(default)]` for backward compat (deserializes to `""` from old data, which triggers fallback to project path at use sites). Avoids Option unwrapping everywhere.

- **`base_commit` as `Option<String>`**: Null for non-git directories. Uses `#[serde(default, skip_serializing_if = "Option::is_none")]` matching the `exit_code`/`exited_at` pattern.

- **`git ls-files --cached --others --exclude-standard -- '*.md'` for .gitignore-aware listing**: Gets both tracked and untracked .md files while respecting .gitignore. Falls back to recursive `std::fs::read_dir` walk for non-git directories. No `ignore` crate needed.

## Open Questions

### Resolved During Planning

- **Refresh mechanism (R22, R24)**: Frontend polling at ~2s intervals when tab is active. Backend provides stateless one-shot commands. No file watcher.
- **Markdown library (R14)**: `react-markdown` + `remark-gfm` + `rehype-highlight`
- **Diff rendering approach (R19)**: Frontend renders unified diff text via `diff2html`. Backend runs `git diff` and returns raw text.
- **`.gitignore` in subdirectories (R11)**: `git ls-files` handles this natively — it walks up to find the repo root and applies all relevant .gitignore files regardless of CWD.
- **base_commit after force-push (R21)**: Backend catches `git diff` failure, frontend shows "Diff unavailable" with fallback to `git diff HEAD` (uncommitted only).

### Deferred to Implementation

- Sidebar collapse toggle affordance and width details (R10) — straightforward CSS, resolve during implementation
- Exact `highlight.js` language set to bundle — can be tuned after initial integration
- Whether to cap diff output size for very large diffs — add truncation if performance problems arise

## Implementation Units

- [ ] **Unit 1: Backend model and session lifecycle changes**

**Goal:** Add `working_dir` and `base_commit` fields to the Session model, inject defaults during session creation and restart, and persist them.

**Requirements:** R1, R3, R4, R17

**Dependencies:** None

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/sessions.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/tests/integration.rs`

**Approach:**
- Add `working_dir: String` with `#[serde(default)]` to Session struct. Add `base_commit: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`
- In `create_session` (line 80): set `working_dir` to `project_dir.clone()`, run `git rev-parse HEAD` in that directory to get `base_commit` (None if it fails)
- In `restart_session` (line 345): re-record `base_commit` by running `git rev-parse HEAD` in the session's current `working_dir` (not project_dir — it may have been updated via hook)
- In `state.rs` load logic: if `working_dir` deserializes as empty string (from old data), leave it — the backend commands will check and fall back to project path
- Fix pre-existing issue: `make_session` helper in integration.rs is missing `exit_code` and `exited_at` — add them along with the new fields
- Add a small helper function `resolve_base_commit(dir: &str) -> Option<String>` that runs `git rev-parse HEAD`, validates the output matches `/^[0-9a-fA-F]{40}$/` (preventing argument injection if a crafted repo returns unexpected output), and returns the SHA or None
- Add a method `Session::effective_working_dir(&self, project_path: &str) -> &str` that returns `working_dir` if non-empty, or `project_path` as fallback. All backend commands must use this method — never read `working_dir` raw

**Patterns to follow:**
- `exit_code` / `exited_at` field pattern in `models.rs`
- Session struct literal construction in `create_session` (line 80)

**Test scenarios:**
- Happy path: create_session sets working_dir to project path and base_commit to HEAD SHA when in a git repo
- Happy path: restart_session updates base_commit to current HEAD
- Edge case: create_session in a non-git directory sets base_commit to None
- Edge case: session with empty working_dir (from old persisted data) loads without error
- Integration: persist a session with working_dir and base_commit, reload, verify fields survived roundtrip

**Verification:**
- Sessions created in git repos have non-null base_commit
- Sessions created in non-git dirs have null base_commit
- Restarted sessions get fresh base_commit
- Old persisted data (without the new fields) loads without errors

---

- [ ] **Unit 2: Hook server working_dir endpoint**

**Goal:** Add a hook server endpoint that allows agents to report a changed working directory for their session.

**Requirements:** R2

**Dependencies:** Unit 1

**Files:**
- Modify: `src-tauri/src/hook_server.rs`
- Test: `src-tauri/tests/integration.rs`

**Approach:**
- Add `POST /session/{session_id}/working_dir` route following the existing `handle_status` pattern
- Request body: `{ "working_dir": "/path/to/worktree" }`
- Handler: validate session exists, validate path is an existing directory (`std::fs::metadata`), **canonicalize both paths and verify the new path is equal to or a descendant of the session's `project.path`** (containment check — prevents redirecting to `/etc`, `~/.ssh`, etc.), update `working_dir` on the session, re-record `base_commit` from the new directory, persist, emit `session-working-dir-{session_id}` event
- Re-recording `base_commit` on working_dir change ensures the diff baseline resets when the agent enters a new worktree

**Patterns to follow:**
- `handle_status` handler in `hook_server.rs` (lines 74-123)
- `StatusUpdate` / `SessionStatusEvent` struct patterns
- Two-tier event emission: `emit_to` project window + `emit` broadcast

**Test scenarios:**
- Happy path: POST valid working_dir updates session's working_dir and base_commit
- Error path: POST with non-existent directory returns 400
- Error path: POST with invalid session_id returns 404
- Edge case: POST working_dir pointing to a non-git directory sets base_commit to None
- Integration: after updating working_dir, subsequent file listing and diff commands use the new path

**Verification:**
- curl to the endpoint updates the session's working_dir in state
- Event is emitted to the frontend on successful update

---

- [ ] **Unit 3: Backend commands for file listing and diff**

**Goal:** Add Tauri commands that the frontend can invoke to list markdown files and compute the session diff.

**Requirements:** R3, R11, R14, R18, R21

**Dependencies:** Unit 1

**Files:**
- Create: `src-tauri/src/commands/files.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/integration.rs`

**Approach:**
- New `files.rs` module with two commands:

  `list_markdown_files(session_id) -> Vec<String>`:
  - Resolve effective working directory via a centralized helper (see Unit 1's `effective_working_dir` method — never use `working_dir` raw without fallback)
  - If in a git repo (`git rev-parse --show-toplevel` succeeds): run `git ls-files --cached --others --exclude-standard -- '*.md'` from `working_dir`
  - If not a git repo: recursive `std::fs::read_dir` walk collecting `*.md` files
  - Return relative paths sorted alphabetically

  `get_session_diff(session_id) -> DiffResult`:
  - Look up session's `working_dir` and `base_commit`
  - If `base_commit` is None: return `DiffResult::NotGitRepo`
  - Run `git diff <base_commit>` in `working_dir`
  - If git fails (e.g., base_commit unreachable): try `git diff HEAD` as fallback, return with error flag
  - Return `DiffResult::Ok { diff_text, changed_files, fallback_used }` or `DiffResult::Error { message }`
  - Parse changed file names from diff headers (`diff --git a/... b/...`) for the file list

  `read_markdown_file(session_id, relative_path) -> String`:
  - Resolve `working_dir / relative_path`, **canonicalize both paths via `std::fs::canonicalize`** and validate the resolved path starts with the canonicalized `working_dir` (handles symlink escapes, `..` traversal, and `.` components)
  - Read and return file contents

- Register all three commands in `lib.rs` invoke_handler

**Patterns to follow:**
- Existing command pattern in `src-tauri/src/commands/sessions.rs`
- State access via `state: tauri::State<'_, Arc<AppState>>`

**Test scenarios:**
- Happy path: list_markdown_files in a git repo returns tracked .md files, respecting .gitignore
- Happy path: get_session_diff returns unified diff text since base_commit
- Happy path: read_markdown_file returns file contents for a valid relative path
- Edge case: list_markdown_files in non-git directory returns all .md files via recursive walk
- Edge case: get_session_diff with no base_commit returns NotGitRepo
- Error path: get_session_diff when base_commit is unreachable falls back to git diff HEAD
- Error path: read_markdown_file with path traversal attempt (e.g., `../../etc/passwd`) returns error
- Edge case: list_markdown_files with empty working_dir falls back to project path
- Edge case: get_session_diff with no changes returns empty diff

**Verification:**
- Commands return correct data for a test git repo with known files and commits
- .gitignore is respected (files in node_modules/.md not listed)
- Path traversal protection works

---

- [ ] **Unit 4: Frontend types, store, and tab system**

**Goal:** Update frontend types for new Session fields, add per-session tab state to the store, and build the tabbed container that replaces the standalone terminal view.

**Requirements:** R5, R6, R7, R8, R9

**Dependencies:** Unit 1 (for new backend fields)

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/components/SessionView.tsx`
- Modify: `src/components/Terminal.tsx`
- Modify: `src/hooks/useTerminal.ts`
- Modify: `src/hooks/useSessionEvents.ts`
- Create: `src/components/TabBar.tsx`
- Test: `src/components/__tests__/TabBar.test.tsx`

**Approach:**
- **sessionStore.ts**: Add `working_dir: string` and `base_commit: string | null` to `BackendSession` (snake_case). Add `workingDir` and `baseCommit` to `SessionData` (camelCase). Update `backendToFrontend`. Add `activeTabBySession: Map<string, "terminal" | "markdown" | "diff">` state with `setActiveTab(sessionId, tab)` action. Default to `"terminal"`.

- **TabBar.tsx**: Simple tab bar component — three tabs with labels, active state styling, click handler. Renders above the tab content area. Tailwind styling consistent with the existing session panel aesthetic.

- **SessionView.tsx**: Replace `<TerminalView />` with:
  ```
  <TabBar /> 
  <div> <!-- tab content container -->
    <TerminalView style={display: activeTab === "terminal"} />
    <MarkdownBrowser style={display: activeTab === "markdown"} />  <!-- Unit 5 -->
    <DiffViewer style={display: activeTab === "diff"} />           <!-- Unit 6 -->
  </div>
  ```
  All three tab contents are always mounted, visibility controlled by `display:none/block`. This preserves the existing terminal always-mounted pattern (R8) and extends it to the other tabs.

- **useTerminal.ts**: Add `Cmd+Shift+1/2/3` handler before the existing `Cmd+1-9` handler. Check `ev.metaKey && ev.shiftKey && ev.code in ['Digit1','Digit2','Digit3']` first — if true, call `setActiveTab` and return `false`. Only if shiftKey is false, fall through to the existing `Cmd+1-9` session-switching handler. This ordering prevents Cmd+Shift+1 from also triggering session switch.

- **useSessionEvents.ts**: Add listener for `session-working-dir-{session_id}` events (following the existing session-status/session-exited pattern). On receipt, update `workingDir` and `baseCommit` on the session's `SessionData` in the store. This keeps frontend state in sync when agents change working directories via the hook server.

**Patterns to follow:**
- `backendToFrontend` mapping in `sessionStore.ts`
- `display:none/block` visibility pattern in `Terminal.tsx`
- `attachCustomKeyEventHandler` in `useTerminal.ts`

**Test scenarios:**
- Happy path: TabBar renders three tabs, clicking a tab calls setActiveTab
- Happy path: Terminal tab is default on session open
- Happy path: switching to Markdown tab hides terminal (display:none), shows markdown (display:block)
- Happy path: switching back to Terminal tab — terminal is still functional (no remount)
- Edge case: switching sessions preserves each session's last-active tab
- Happy path: Cmd+Shift+1/2/3 switches tabs (test via key event simulation)
- Edge case: Cmd+1-9 still switches sessions (not intercepted by tab handler)

**Verification:**
- Tab switching is instant — no flash, no remount
- Terminal continues streaming PTY output while on another tab
- Keyboard shortcuts work even when terminal has focus

---

- [ ] **Unit 5: Markdown browser component**

**Goal:** Build the Markdown tab — file list sidebar with rendered preview panel, with polling-based refresh.

**Requirements:** R10, R11, R12, R13, R14, R15, R16, R22, R23, R25

**Dependencies:** Unit 3 (backend commands), Unit 4 (tab system)

**Files:**
- Create: `src/components/MarkdownBrowser.tsx`
- Create: `src/hooks/useMarkdownFiles.ts`
- Test: `src/components/__tests__/MarkdownBrowser.test.tsx`

**Approach:**
- **useMarkdownFiles hook**: Polls `list_markdown_files` command every ~2s when the Markdown tab is active. Returns `{ files, selectedFile, setSelectedFile, content, isLoading }`. Fetches file content via `read_markdown_file` when selection changes. Stops polling when tab is inactive or session is not running. Handles file deletion (selected file disappears from list → show "File no longer exists"). Minimum 500ms between fetches (debounce).

- **MarkdownBrowser.tsx**: Two-panel layout:
  - Left sidebar (~25% width, `min-w-48`): flat file list with relative paths, sorted alphabetically. Click to select. Highlight active file. Collapsible via a toggle (simple `display:none` on sidebar content, chevron button).
  - Right panel: rendered markdown via `react-markdown` with `remark-gfm` and `rehype-highlight` plugins. Scrollable. Shows placeholder "Select a file to preview" when no file selected (R13). Shows "File no longer exists" when selected file is deleted (R15).
  - Loading skeleton on first activation (R25).
  - Empty state: "No markdown files found" when file list is empty.

- **Dependencies to install**: `react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-sanitize`, `highlight.js` (peer dep of rehype-highlight). Plugin order: remark-gfm → rehype-highlight → rehype-sanitize. The sanitize step prevents XSS from agent-authored markdown (script tags, javascript: links, data: URIs) — critical since the Tauri webview has IPC access.

**Patterns to follow:**
- Zustand store access pattern from existing components
- Tailwind utility classes matching existing UI aesthetic
- `invoke()` pattern from `sessionStore.ts` for Tauri commands

**Test scenarios:**
- Happy path: file list shows .md files from working_dir, sorted alphabetically
- Happy path: clicking a file renders its markdown content with GFM formatting
- Happy path: code blocks in markdown have syntax highlighting
- Edge case: empty working_dir (no .md files) shows "No markdown files found"
- Edge case: no file selected shows "Select a file to preview"
- Edge case: selected file deleted by agent shows "File no longer exists"
- Happy path: file list updates when new .md files are created (next poll cycle)
- Edge case: very long file list is scrollable in the sidebar
- Happy path: loading skeleton shown on first activation before data arrives

**Verification:**
- Markdown renders correctly with headings, lists, tables, code blocks, task lists
- File list respects .gitignore (no node_modules READMEs)
- Polling pauses when tab is not active

---

- [ ] **Unit 6: Diff viewer component**

**Goal:** Build the Diff tab — cumulative session diff with file list header and anchor-scroll navigation.

**Requirements:** R17, R18, R19, R20, R21, R22, R24, R25

**Dependencies:** Unit 3 (backend commands), Unit 4 (tab system)

**Files:**
- Create: `src/components/DiffViewer.tsx`
- Create: `src/hooks/useDiff.ts`
- Test: `src/components/__tests__/DiffViewer.test.tsx`

**Approach:**
- **useDiff hook**: Polls `get_session_diff` command every ~2s when the Diff tab is active. Returns `{ diffHtml, changedFiles, isEmpty, isNotGit, error, fallbackUsed, lastUpdated, isLoading }`. Tracks `lastUpdated` timestamp for the "last updated: Ns ago" indicator. Stops polling when tab is inactive. Minimum 500ms between fetches.

- **DiffViewer.tsx**:
  - File list header: horizontal bar of changed file names. Clicking a file highlights it and scrolls to its section in the diff body via `element.scrollIntoView()`. No file highlighted initially (R20).
  - Diff body: rendered via `diff2html`. Unified format. The diff2html `Diff2HtmlUI` or `html()` function converts raw unified diff text to styled HTML. Apply custom CSS to match the Séance theme (dark/light mode aware via Tailwind).
  - "Last updated: Ns ago" indicator in the header area, updating every 10s.
  - Loading skeleton on first activation (R25).
  - Empty states per R21: "Not a git repository", "No changes since session start", "Diff unavailable: {error}" with fallback notice.

- **Dependencies to install**: `diff2html`, `dompurify` (sanitize diff2html HTML output before DOM injection — git diff output contains agent-controlled file paths and content that could include XSS payloads). Import diff2html CSS via `diff2html/bundles/css/diff2html.min.css` and scope under a container class with `@layer` to prevent Tailwind conflicts.

**Patterns to follow:**
- Polling pattern from `useMarkdownFiles` hook (Unit 5)
- Tailwind dark/light theme from existing components
- `scrollIntoView({ behavior: 'smooth' })` for anchor-scroll

**Test scenarios:**
- Happy path: diff shows colored unified diff with added/removed lines
- Happy path: file list header shows changed file names
- Happy path: clicking a file in header scrolls to its diff section
- Edge case: non-git directory shows "Not a git repository"
- Edge case: no changes shows "No changes since session start"
- Error path: unreachable base_commit shows fallback notice with uncommitted-only diff
- Happy path: diff updates on next poll cycle after agent makes changes
- Happy path: "last updated" indicator shows time since last fetch
- Edge case: very large diff is scrollable
- Happy path: loading skeleton on first activation

**Verification:**
- Diff accurately reflects all changes since session start (committed + uncommitted)
- File navigation via header works (scroll-to-file)
- Diff renders correctly in both light and dark themes

---

- [ ] **Unit 7: E2E and integration test updates**

**Goal:** Update the mock backend and E2E test infrastructure, add test coverage for the new features.

**Requirements:** All (cross-cutting)

**Dependencies:** Units 1-6

**Files:**
- Modify: `e2e/types/backend.ts`
- Modify: `e2e/helpers/mock-backend.ts`
- Create: `e2e/tab-navigation.spec.ts`
- Modify: `src-tauri/tests/integration.rs`

**Approach:**
- **e2e/types/backend.ts**: Add `working_dir: string` and `base_commit: string | null` to Session type
- **e2e/helpers/mock-backend.ts**: Add new fields to `makeSession` factory. Add mock handlers for `list_markdown_files`, `get_session_diff`, and `read_markdown_file` commands. Return canned responses.
- **tab-navigation.spec.ts**: E2E tests for tab switching (click and keyboard), tab state persistence across session switches, and basic markdown/diff tab content rendering with mock data
- **integration.rs**: Add tests for `resolve_base_commit` helper. Add tests verifying persistence roundtrip with new fields. (Note: the `make_session` helper fix is handled in Unit 1 — do not duplicate it here.)

**Patterns to follow:**
- Existing E2E test patterns in `e2e/session-lifecycle.spec.ts`
- MockBackend command handler pattern in `e2e/helpers/mock-backend.ts`
- Integration test patterns in `src-tauri/tests/integration.rs`

**Test scenarios:**
- E2E: clicking Terminal/Markdown/Diff tabs shows the correct content
- E2E: Cmd+Shift+1/2/3 switches tabs
- E2E: switching sessions preserves tab selection
- E2E: Markdown tab shows file list and rendered content (mock data)
- E2E: Diff tab shows colored diff (mock data)
- Integration: new Session fields persist and reload correctly
- Integration: make_session helper compiles and produces valid Session structs

**Verification:**
- All existing E2E tests still pass (no regression)
- New tab-switching and content tests pass
- Rust integration tests pass with updated make_session helper

## System-Wide Impact

- **Interaction graph**: New Tauri commands (`list_markdown_files`, `get_session_diff`, `read_markdown_file`) are invoked from frontend hooks. Hook server gains a new `/session/{session_id}/working_dir` endpoint invoked by external agents. New `session-working-dir-{session_id}` Tauri event emitted on working_dir change.
- **Error propagation**: Git command failures in backend return structured error types to frontend. Frontend renders error states per R21. Hook server returns HTTP 400/404 for invalid requests.
- **State lifecycle risks**: `working_dir` and `base_commit` changes must persist atomically with the rest of the session state. The existing persist-on-mutation pattern handles this. Tab selection state is ephemeral (in-memory only) — lost on app restart, which is acceptable per R7.
- **API surface parity**: The hook server's new endpoint is the only new external API surface. All Tauri commands are internal (frontend → backend).
- **Unchanged invariants**: The existing terminal behavior (PTY streaming, scrollback, session switching, Cmd+1-9 shortcuts) must be completely unaffected. The terminal component stays always-mounted — the tab system wraps it, not replaces it.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `react-markdown` bundle size adds to app weight | Tree-shakeable; `highlight.js` can load only needed languages. Monitor bundle size after integration. |
| `diff2html` CSS may conflict with Tailwind | Scope diff2html styles under a container class. Test both themes. |
| Polling at 2s intervals may feel laggy for real-time monitoring | Acceptable for v1. Can upgrade to `notify`-based file watching later if user feedback demands it. |
| Large git diffs (1000+ files) may be slow to render | Add client-side truncation with "showing first N files" if performance issues arise. Defer to implementation. |
| `git ls-files` in large monorepos may be slow | The command is fast for most repos. If needed, add output capping or async execution. |
| macOS Cmd+Shift+1/2/3 key detection (`ev.code` vs `ev.key`) | Use `ev.code` (Digit1/2/3) not `ev.key` (which produces !/\@/# with shift). Documented in Key Technical Decisions. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-06-markdown-diff-viewer-requirements.md](docs/brainstorms/2026-04-06-markdown-diff-viewer-requirements.md)
- **Institutional learnings:** `docs/solutions/integration-issues/tauri-frontend-backend-field-naming-mismatches-2026-04-05.md`, `docs/solutions/best-practices/typed-mock-backend-for-tauri-e2e-tests-2026-04-05.md`, `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md`
- **Libraries:** [react-markdown](https://github.com/remarkjs/react-markdown), [diff2html](https://github.com/rtfpessoa/diff2html), [remark-gfm](https://github.com/remarkjs/remark-gfm), [rehype-highlight](https://github.com/rehypejs/rehype-highlight)
