use crate::models::AppSettings;
use crate::state::AppState;
use std::sync::Arc;

#[tauri::command]
pub async fn get_app_settings(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<AppSettings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn update_app_settings(
    state: tauri::State<'_, Arc<AppState>>,
    settings: AppSettings,
) -> Result<(), String> {
    {
        let mut current = state.settings.write().await;
        *current = settings;
    }

    state.persist().await?;
    Ok(())
}
