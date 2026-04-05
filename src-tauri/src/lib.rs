mod commands;
pub mod identity;
mod models;
mod persistence;
mod pty_engine;
mod scrollback;
mod state;

use persistence::Persistence;
use state::AppState;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let persistence = Persistence::new(&app_data_dir);
            let state = Arc::new(AppState::new(persistence));
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::list_projects,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::update_project_settings,
            commands::settings::get_app_settings,
            commands::settings::update_app_settings,
            commands::sessions::create_session,
            commands::sessions::kill_session,
            commands::sessions::send_input,
            commands::sessions::resize_pty,
            commands::sessions::get_scrollback,
            commands::sessions::subscribe_output,
            commands::sessions::restart_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
