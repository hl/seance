use crate::models::Project;
use crate::state::AppState;
use std::sync::Arc;
use uuid::Uuid;

#[derive(serde::Deserialize)]
pub struct ProjectSettings {
    pub command_template: String,
}

#[derive(serde::Serialize)]
pub struct SessionSummary {
    pub id: Uuid,
    pub status: crate::models::SessionStatus,
}

#[derive(serde::Serialize)]
pub struct ProjectWithSessions {
    #[serde(flatten)]
    pub project: Project,
    pub active_session_count: usize,
    pub sessions: Vec<SessionSummary>,
}

#[tauri::command]
pub async fn list_projects(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<ProjectWithSessions>, String> {
    let projects = state.projects.read().await;
    let sessions = state.sessions.read().await;

    let mut result: Vec<ProjectWithSessions> = projects
        .values()
        .map(|p| {
            let project_sessions: Vec<SessionSummary> = sessions
                .values()
                .filter(|s| s.project_id == p.id)
                .map(|s| SessionSummary {
                    id: s.id,
                    status: s.status,
                })
                .collect();
            let active_count = project_sessions
                .iter()
                .filter(|s| {
                    !matches!(
                        s.status,
                        crate::models::SessionStatus::Exited
                            | crate::models::SessionStatus::Done
                    )
                })
                .count();
            ProjectWithSessions {
                project: p.clone(),
                active_session_count: active_count,
                sessions: project_sessions,
            }
        })
        .collect();

    result.sort_by(|a, b| a.project.created_at.cmp(&b.project.created_at));
    Ok(result)
}

#[tauri::command]
pub async fn add_project(
    state: tauri::State<'_, Arc<AppState>>,
    path: String,
) -> Result<Project, String> {
    let project = Project {
        id: Uuid::new_v4(),
        path,
        command_template: String::new(),
        created_at: timestamp_now(),
    };

    {
        let mut projects = state.projects.write().await;
        projects.insert(project.id, project.clone());
    }

    state.persist().await?;
    Ok(project)
}

#[tauri::command]
pub async fn remove_project(
    state: tauri::State<'_, Arc<AppState>>,
    id: Uuid,
) -> Result<(), String> {
    {
        let mut projects = state.projects.write().await;
        if projects.remove(&id).is_none() {
            return Err(format!("Project {} not found", id));
        }
    }

    // Collect session IDs belonging to this project, then kill their PTYs.
    let session_ids: Vec<Uuid> = {
        let sessions = state.sessions.read().await;
        sessions
            .values()
            .filter(|s| s.project_id == id)
            .map(|s| s.id)
            .collect()
    };

    {
        let mut handles = state.session_handles.write().await;
        for sid in &session_ids {
            if let Some(mut handle) = handles.remove(sid) {
                let _ = handle.killer.kill();
            }
        }
    }

    // Clean up exited scrollback snapshots for these sessions.
    {
        let mut exited = state.exited_scrollback.write().await;
        for sid in &session_ids {
            exited.remove(sid);
        }
    }

    // Remove all sessions for this project.
    {
        let mut sessions = state.sessions.write().await;
        sessions.retain(|_, s| s.project_id != id);
    }

    state.persist().await?;
    Ok(())
}

#[tauri::command]
pub async fn update_project_settings(
    state: tauri::State<'_, Arc<AppState>>,
    id: Uuid,
    settings: ProjectSettings,
) -> Result<(), String> {
    {
        let mut projects = state.projects.write().await;
        let project = projects
            .get_mut(&id)
            .ok_or_else(|| format!("Project {} not found", id))?;
        project.command_template = settings.command_template;
    }

    state.persist().await?;
    Ok(())
}

use crate::state::timestamp_now;
