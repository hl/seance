use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub path: String,
    pub command_template: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub project_id: Uuid,
    pub task: String,
    pub generated_name: String,
    #[serde(default)]
    pub status: SessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_known_pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exited_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    #[default]
    Exited,
    Running,
    Thinking,
    Waiting,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_hook_port")]
    pub hook_port: u16,
    #[serde(default = "default_font_size")]
    pub terminal_font_size: u16,
    #[serde(default = "default_theme")]
    pub terminal_theme: String,
    #[serde(default = "default_app_theme")]
    pub app_theme: String,
}

fn default_hook_port() -> u16 {
    7837
}
fn default_font_size() -> u16 {
    14
}
fn default_theme() -> String {
    "system".to_string()
}
fn default_app_theme() -> String {
    "system".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hook_port: default_hook_port(),
            terminal_font_size: default_font_size(),
            terminal_theme: default_theme(),
            app_theme: default_app_theme(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedState {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub sessions: Vec<Session>,
    #[serde(default)]
    pub settings: AppSettings,
}
