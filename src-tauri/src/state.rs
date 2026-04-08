use crate::models::{AppSettings, PersistedState, Project, Session, SessionStatus};
use crate::persistence::Persistence;
use crate::pty_engine::SessionHandle;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::{watch, RwLock};
use uuid::Uuid;

pub struct AppState {
    pub projects: RwLock<HashMap<Uuid, Project>>,
    pub sessions: RwLock<HashMap<Uuid, Session>>,
    pub settings: RwLock<AppSettings>,
    pub session_handles: RwLock<HashMap<Uuid, SessionHandle>>,
    /// Final scrollback snapshots for exited sessions (after handle cleanup).
    pub exited_scrollback: RwLock<HashMap<Uuid, Vec<u8>>>,
    pub persistence: Persistence,
    /// Tauri AppHandle for emitting events from non-command contexts (exit watcher, etc.)
    pub app_handle: RwLock<Option<tauri::AppHandle>>,
    /// Random token generated per app instance for hook server authentication.
    pub hook_token: String,
    /// Sender to signal the hook server to shut down for restart.
    /// Wrapped in Mutex so it can be swapped when the port changes.
    pub hook_shutdown_tx: Mutex<watch::Sender<()>>,
    /// Receiver cloned by the hook server to listen for shutdown.
    pub hook_shutdown_rx: watch::Receiver<()>,
}

impl AppState {
    pub fn new(persistence: Persistence, app_handle: Option<tauri::AppHandle>) -> Self {
        let persisted = persistence.load();

        let mut projects = HashMap::new();
        for p in persisted.projects {
            projects.insert(p.id, p);
        }

        let mut sessions = HashMap::new();
        for mut s in persisted.sessions {
            // Sessions always load as exited (R29)
            s.status = SessionStatus::Exited;
            s.last_message = None;
            sessions.insert(s.id, s);
        }

        let (hook_shutdown_tx, hook_shutdown_rx) = watch::channel(());

        Self {
            projects: RwLock::new(projects),
            sessions: RwLock::new(sessions),
            settings: RwLock::new(persisted.settings),
            session_handles: RwLock::new(HashMap::new()),
            exited_scrollback: RwLock::new(HashMap::new()),
            persistence,
            app_handle: RwLock::new(app_handle),
            hook_token: Uuid::new_v4().to_string(),
            hook_shutdown_tx: Mutex::new(hook_shutdown_tx),
            hook_shutdown_rx,
        }
    }

    /// Create AppState without an AppHandle (for tests).
    pub fn new_for_test(persistence: Persistence) -> Self {
        Self::new(persistence, None)
    }

    pub async fn persist(&self) -> Result<(), String> {
        // Clone data under each lock separately to minimize lock hold times.
        let projects: Vec<Project> = self.projects.read().await.values().cloned().collect();
        let sessions: Vec<Session> = self.sessions.read().await.values().cloned().collect();
        let settings: AppSettings = self.settings.read().await.clone();

        let state = PersistedState {
            projects,
            sessions,
            settings,
        };

        self.persistence.save(&state)
    }
}

/// Shell-escape a value so it can be safely interpolated into a shell command.
/// Wraps the value in single quotes, escaping any embedded single quotes.
fn shell_escape(value: &str) -> String {
    // Empty string -> ''
    if value.is_empty() {
        return "''".to_string();
    }
    // If the value contains no special characters, return as-is
    if value
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '/' | '.' | ',' | ':' | '@'))
    {
        return value.to_string();
    }
    // Wrap in single quotes; escape embedded single quotes as '\''
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Current timestamp as epoch seconds string.
pub fn timestamp_now() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

pub fn resolve_template(
    template: &str,
    session_name: &str,
    task: &str,
    project_dir: &str,
) -> String {
    template
        .replace("{{session_name}}", &shell_escape(session_name))
        .replace("{{task}}", &shell_escape(task))
        .replace("{{project_dir}}", &shell_escape(project_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_template_all_placeholders() {
        let result = resolve_template(
            "claude -w {{task}} --name {{session_name}} --dir {{project_dir}}",
            "Maya",
            "fix-auth",
            "/home/user/project",
        );
        assert_eq!(
            result,
            "claude -w fix-auth --name Maya --dir /home/user/project"
        );
    }

    #[test]
    fn test_resolve_template_unknown_placeholder_passthrough() {
        let result = resolve_template("cmd {{task}} {{unknown}}", "Maya", "fix", "/tmp");
        assert_eq!(result, "cmd fix {{unknown}}");
    }

    #[test]
    fn test_resolve_template_no_placeholders() {
        let result = resolve_template("simple command", "Maya", "fix", "/tmp");
        assert_eq!(result, "simple command");
    }

    #[test]
    fn test_shell_escape_simple_values() {
        assert_eq!(shell_escape("fix-auth"), "fix-auth");
        assert_eq!(shell_escape("/home/user/project"), "/home/user/project");
    }

    #[test]
    fn test_shell_escape_spaces() {
        assert_eq!(shell_escape("/home/user/my project"), "'/home/user/my project'");
    }

    #[test]
    fn test_shell_escape_metacharacters() {
        assert_eq!(shell_escape("test; rm -rf /"), "'test; rm -rf /'");
        assert_eq!(shell_escape("$(whoami)"), "'$(whoami)'");
        assert_eq!(shell_escape("`whoami`"), "'`whoami`'");
    }

    #[test]
    fn test_shell_escape_single_quotes() {
        assert_eq!(shell_escape("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_shell_escape_empty() {
        assert_eq!(shell_escape(""), "''");
    }

    #[test]
    fn test_resolve_template_escapes_project_dir_with_spaces() {
        let result = resolve_template(
            "claude --dir {{project_dir}}",
            "Maya",
            "fix",
            "/Users/me/my project",
        );
        assert_eq!(result, "claude --dir '/Users/me/my project'");
    }
}
