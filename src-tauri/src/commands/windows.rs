use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// Open (or focus) a project window.
///
/// Creates a new Tauri window with the label `project-{project_id}`.
/// If a window with that label already exists, it is focused instead.
/// The project ID, name, and path are passed via URL query params so the
/// frontend can route to the correct project on mount.
#[tauri::command]
pub async fn open_project_window(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    project_id: String,
    project_name: String,
) -> Result<(), String> {
    let label = format!("project-{}", project_id);

    // If a window with this label already exists, just focus it.
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Look up the project path from state.
    let project_path = {
        let projects = state.projects.read().await;
        let uuid = Uuid::parse_str(&project_id)
            .map_err(|e| format!("Invalid project ID: {}", e))?;
        projects
            .get(&uuid)
            .map(|p| p.path.clone())
            .ok_or_else(|| format!("Project {} not found", project_id))?
    };

    // Build the URL with query params for the frontend to read.
    let encoded_name = urlencoding::encode(&project_name);
    let encoded_path = urlencoding::encode(&project_path);
    let url = format!(
        "index.html?projectId={}&projectName={}&projectPath={}",
        project_id, encoded_name, encoded_path
    );

    tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(format!("{} — Séance", project_name))
    .inner_size(1200.0, 800.0)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}
