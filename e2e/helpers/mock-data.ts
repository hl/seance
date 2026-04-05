/**
 * Shared mock data used across E2E tests.
 *
 * The shapes mirror the Rust backend's serialised types so we can catch
 * contract mismatches early (the exact class of bug this test suite exists
 * to prevent).
 */

export const MOCK_PROJECTS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    path: "/Users/test/projects/my-app",
    name: "",
    command_template: "claude -w {{task}}",
    created_at: "1712300000",
    active_session_count: 1,
    sessions: [
      { id: "aaaa1111-1111-1111-1111-111111111111", status: "running" },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    path: "/Users/test/projects/another-project",
    name: "",
    command_template: "codex --dir {{project_dir}}",
    created_at: "1712400000",
    active_session_count: 0,
    sessions: [],
  },
];

export const MOCK_SETTINGS = {
  hook_port: 7837,
  terminal_font_size: 14,
  terminal_theme: "system",
};
