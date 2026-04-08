/**
 * TypeScript types mirroring the Rust backend's Tauri command
 * request/response shapes. Each type links to its Rust source.
 *
 * These are the SINGLE SOURCE OF TRUTH for E2E mock data shapes.
 * When the Rust backend changes a struct, update this file — TypeScript
 * compilation will then flag every mock that needs updating.
 */

// --- Models (src-tauri/src/models.rs) ---

/** Mirrors: models::SessionStatus */
export type SessionStatus =
  | "running"
  | "thinking"
  | "waiting"
  | "done"
  | "error"
  | "exited";

/** Mirrors: models::AppSettings */
export interface AppSettings {
  hook_port: number;
  terminal_font_size: number;
  terminal_theme: string;
  app_theme: string;
}

/** Mirrors: models::Project */
export interface Project {
  id: string;
  path: string;
  command_template: string;
  created_at: string;
}

/** Mirrors: models::Session */
export interface Session {
  id: string;
  project_id: string;
  task: string;
  generated_name: string;
  status: SessionStatus;
  last_message: string | null;
  created_at: string;
  last_started_at: string | null;
  last_known_pid: number | null;
  exit_code: number | null;
  exited_at: string | null;
  working_dir: string;
  base_commit: string | null;
}

/** Mirrors: commands::files::DiffResult */
export type DiffResult =
  | { kind: "ok"; diff_text: string; changed_files: string[]; fallback_used: boolean }
  | { kind: "no_changes" }
  | { kind: "not_git_repo" }
  | { kind: "error"; message: string };

// --- Command responses (src-tauri/src/commands/projects.rs) ---

/** Mirrors: commands::projects::SessionSummary */
export interface SessionSummary {
  id: string;
  status: SessionStatus;
}

/** Mirrors: commands::projects::ProjectWithSessions (list_projects response) */
export interface ProjectWithSessions extends Project {
  active_session_count: number;
  sessions: SessionSummary[];
}

/** Mirrors: commands::projects::ProjectSettings (update_project_settings arg) */
export interface ProjectSettings {
  command_template: string;
}

// --- Command argument/response map ---

/** All Tauri commands with their argument and return types */
export interface TauriCommands {
  list_projects: { args: Record<string, never>; response: ProjectWithSessions[] };
  add_project: { args: { path: string }; response: Project };
  remove_project: { args: { id: string }; response: null };
  update_project_settings: { args: { id: string; settings: ProjectSettings }; response: null };
  create_session: { args: { projectId: string; task: string }; response: Session };
  kill_session: { args: { sessionId: string }; response: null };
  send_input: { args: { sessionId: string; data: string }; response: null };
  resize_pty: { args: { sessionId: string; cols: number; rows: number }; response: null };
  get_scrollback: { args: { sessionId: string }; response: number[] };
  subscribe_output: { args: { sessionId: string; onOutput: unknown }; response: number[] };
  restart_session: { args: { sessionId: string }; response: Session };
  delete_session: { args: { sessionId: string }; response: null };
  rename_session: { args: { sessionId: string; name: string }; response: null };
  get_app_settings: { args: Record<string, never>; response: AppSettings };
  update_app_settings: { args: { settings: AppSettings }; response: null };
  open_project_window: { args: { projectId: string; projectName: string }; response: null };
  list_markdown_files: { args: { sessionId: string }; response: string[] };
  get_session_diff: { args: { sessionId: string }; response: DiffResult };
  read_markdown_file: { args: { sessionId: string; relativePath: string }; response: string };
}

export type CommandName = keyof TauriCommands;
