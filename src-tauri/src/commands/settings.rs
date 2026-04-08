use crate::hook_server;
use crate::models::AppSettings;
use crate::state::AppState;
use std::sync::Arc;
use tokio::sync::watch;

#[tauri::command]
pub async fn get_app_settings(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<AppSettings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn update_app_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: AppSettings,
) -> Result<(), String> {
    if settings.hook_port == 0 {
        return Err("Hook port cannot be 0".to_string());
    }

    let old_port = {
        let current = state.settings.read().await;
        current.hook_port
    };
    let new_port = settings.hook_port;

    {
        let mut current = state.settings.write().await;
        *current = settings;
    }

    state.persist().await?;

    // If the hook port changed, restart the hook server.
    if new_port != old_port {
        // Create a new shutdown channel for the new server.
        let (new_tx, new_rx) = watch::channel(());

        // Swap the sender — signal the old server, install the new one.
        {
            let mut tx = state.hook_shutdown_tx.lock().unwrap_or_else(|e| e.into_inner());
            let _ = tx.send(()); // Signal old server to shut down.
            *tx = new_tx;        // Install new sender for future port changes.
        }

        let state_clone: Arc<AppState> = state.inner().clone();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(
            hook_server::start_hook_server(state_clone, app_handle, new_port, new_rx),
        );
    }

    Ok(())
}
