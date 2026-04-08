use crate::models::PersistedState;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static SAVE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct Persistence {
    file_path: PathBuf,
}

impl Persistence {
    pub fn new(app_data_dir: &Path) -> Self {
        fs::create_dir_all(app_data_dir).ok();
        Self {
            file_path: app_data_dir.join("seance-data.json"),
        }
    }

    pub fn load(&self) -> PersistedState {
        match fs::read_to_string(&self.file_path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => PersistedState::default(),
        }
    }

    pub fn save(&self, state: &PersistedState) -> Result<(), String> {
        let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
        // Use a unique tmp filename to avoid races between concurrent save() calls.
        let seq = SAVE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp_path = self
            .file_path
            .with_extension(format!("json.tmp.{}.{}", std::process::id(), seq));
        fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;
        // Restrict permissions to owner-only (0600) since the file contains command templates.
        #[cfg(unix)]
        {
            let perms = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&tmp_path, perms).ok();
        }
        fs::rename(&tmp_path, &self.file_path)
            .map_err(|e| format!("Failed to rename temp file: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Project;
    use tempfile::tempdir;
    use uuid::Uuid;

    #[test]
    fn test_load_missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let persistence = Persistence::new(dir.path());
        let state = persistence.load();
        assert!(state.projects.is_empty());
        assert!(state.sessions.is_empty());
        assert_eq!(state.settings.hook_port, 7837);
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let dir = tempdir().unwrap();
        let persistence = Persistence::new(dir.path());

        let mut state = PersistedState::default();
        state.projects.push(Project {
            id: Uuid::new_v4(),
            path: "/tmp/test-project".to_string(),
            command_template: "claude -w {{task}}".to_string(),
            created_at: "2026-04-05T00:00:00Z".to_string(),
        });
        state.settings.hook_port = 9999;

        persistence.save(&state).unwrap();
        let loaded = persistence.load();

        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].path, "/tmp/test-project");
        assert_eq!(loaded.settings.hook_port, 9999);
    }

    #[test]
    fn test_load_corrupt_file_returns_default() {
        let dir = tempdir().unwrap();
        let persistence = Persistence::new(dir.path());
        fs::write(dir.path().join("seance-data.json"), "not json{{{").unwrap();
        let state = persistence.load();
        assert!(state.projects.is_empty());
    }

    #[test]
    fn test_atomic_write_uses_tmp_file() {
        let dir = tempdir().unwrap();
        let persistence = Persistence::new(dir.path());
        let state = PersistedState::default();
        persistence.save(&state).unwrap();
        // tmp file should not exist after successful rename
        assert!(!dir.path().join("seance-data.json.tmp").exists());
        assert!(dir.path().join("seance-data.json").exists());
    }
}
