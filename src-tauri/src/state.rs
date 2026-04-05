use crate::models::{AppSettings, PersistedState, Project, Session, SessionStatus};
use crate::persistence::Persistence;
use crate::pty_engine::SessionHandle;
use std::collections::HashMap;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct AppState {
    pub projects: RwLock<HashMap<Uuid, Project>>,
    pub sessions: RwLock<HashMap<Uuid, Session>>,
    pub settings: RwLock<AppSettings>,
    pub session_handles: RwLock<HashMap<Uuid, SessionHandle>>,
    pub persistence: Persistence,
    /// Tauri AppHandle for emitting events from non-command contexts (exit watcher, etc.)
    pub app_handle: RwLock<Option<tauri::AppHandle>>,
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

        Self {
            projects: RwLock::new(projects),
            sessions: RwLock::new(sessions),
            settings: RwLock::new(persisted.settings),
            session_handles: RwLock::new(HashMap::new()),
            persistence,
            app_handle: RwLock::new(app_handle),
        }
    }

    /// Create AppState without an AppHandle (for tests).
    #[cfg(test)]
    pub fn new_for_test(persistence: Persistence) -> Self {
        Self::new(persistence, None)
    }

    pub async fn persist(&self) -> Result<(), String> {
        let projects = self.projects.read().await;
        let sessions = self.sessions.read().await;
        let settings = self.settings.read().await;

        let state = PersistedState {
            projects: projects.values().cloned().collect(),
            sessions: sessions.values().cloned().collect(),
            settings: settings.clone(),
        };

        self.persistence.save(&state)
    }
}

pub fn resolve_template(
    template: &str,
    session_name: &str,
    task: &str,
    project_dir: &str,
) -> String {
    template
        .replace("{{session_name}}", session_name)
        .replace("{{task}}", task)
        .replace("{{project_dir}}", project_dir)
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
}
