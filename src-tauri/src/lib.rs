#[cfg(unix)]
mod cleanup;
pub mod commands;
mod hook_server;
pub mod identity;
pub mod models;
pub mod persistence;
pub mod pty_engine;
pub mod scrollback;
pub mod state;

use persistence::Persistence;
use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let persistence = Persistence::new(&app_data_dir);
            let state = Arc::new(AppState::new(persistence, Some(app.handle().clone())));

            // Clean up orphaned processes from a previous crash/unclean exit.
            #[cfg(unix)]
            cleanup::cleanup_orphaned_processes(&state);

            // Read hook port synchronously before spawning the server.
            // The setup closure is not async, so we use block_on for
            // the single RwLock read.
            let hook_port = tauri::async_runtime::block_on(async {
                state.settings.read().await.hook_port
            });

            let shutdown_rx = state.hook_shutdown_rx.clone();
            let state_clone = state.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(
                hook_server::start_hook_server(state_clone, app_handle, hook_port, shutdown_rx),
            );

            // Set up signal handler for SIGTERM/SIGINT to kill tracked PIDs.
            // Unix-only: signal-hook and POSIX signals are not available on Windows.
            #[cfg(unix)]
            {
                let signal_state = state.clone();
                std::thread::Builder::new()
                    .name("signal-handler".to_string())
                    .spawn(move || {
                        use signal_hook::consts::{SIGINT, SIGTERM};
                        use signal_hook::iterator::Signals;

                        let mut signals =
                            Signals::new([SIGTERM, SIGINT]).expect("failed to register signals");

                        // Block until we receive a signal.
                        for _sig in signals.forever() {
                            cleanup::kill_all_sessions(&signal_state);
                            std::process::exit(0);
                        }
                    })
                    .expect("failed to spawn signal handler thread");
            }

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
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::delete_session,
            commands::sessions::kill_session,
            commands::sessions::rename_session,
            commands::sessions::send_input,
            commands::sessions::resize_pty,
            commands::sessions::get_scrollback,
            commands::sessions::subscribe_output,
            commands::sessions::restart_session,
            commands::windows::open_project_window,
            commands::files::list_markdown_files,
            commands::files::get_session_diff,
            commands::files::read_markdown_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // code.is_none() means all windows were closed (not Cmd+Q).
            // Keep the app alive so the dock icon stays.
            if code.is_none() {
                api.prevent_exit();
            }
        }

        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            // Dock icon clicked with no visible windows — reopen the picker.
            if !has_visible_windows {
                // Create a new picker window. If one already exists with label
                // "main", focus it instead.
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.set_focus();
                } else {
                    let _ = tauri::WebviewWindowBuilder::new(
                        app_handle,
                        "main",
                        tauri::WebviewUrl::App("index.html".into()),
                    )
                    .title("Séance")
                    .inner_size(1200.0, 800.0)
                    .center()
                    .resizable(true)
                    .build();
                }
            }
        }

        RunEvent::Exit => {
            // App is shutting down — kill all PTY sessions.
            #[cfg(unix)]
            {
                let state = app_handle.state::<Arc<AppState>>();
                cleanup::kill_all_sessions(&state);
            }
        }

        _ => {}
    });
}
