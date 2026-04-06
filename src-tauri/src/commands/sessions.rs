use crate::models::{Session, SessionStatus};
use crate::pty_engine::{self, validate_task_slug};
use crate::state::AppState;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::Emitter;
use uuid::Uuid;

/// Helper: current timestamp as epoch seconds string (same as projects.rs).
fn timestamp_now() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

/// List all sessions for a given project.
#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, Arc<AppState>>,
    project_id: Uuid,
) -> Result<Vec<Session>, String> {
    let sessions = state.sessions.read().await;
    let mut result: Vec<Session> = sessions
        .values()
        .filter(|s| s.project_id == project_id)
        .cloned()
        .collect();
    result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(result)
}

/// Create a new session in the given project, spawning a PTY with the
/// resolved command template.
#[tauri::command]
pub async fn create_session(
    state: tauri::State<'_, Arc<AppState>>,
    project_id: Uuid,
    task: String,
) -> Result<Session, String> {
    // Validate the task slug.
    validate_task_slug(&task)?;

    // Look up the project.
    let (command_template, project_dir) = {
        let projects = state.projects.read().await;
        let project = projects
            .get(&project_id)
            .ok_or_else(|| format!("Project {} not found", project_id))?;
        (project.command_template.clone(), project.path.clone())
    };

    if command_template.is_empty() {
        return Err("Project has no command template configured".to_string());
    }

    // Generate session identity — deterministic name from UUID.
    let session_id = Uuid::new_v4();
    let generated_name = crate::identity::default_name(session_id);

    // Resolve the command template.
    let command_line =
        crate::state::resolve_template(&command_template, &generated_name, &task, &project_dir);

    // Read the hook port from settings.
    let hook_port = {
        let settings = state.settings.read().await;
        settings.hook_port
    };

    // Spawn the PTY. No Channel yet — the Terminal component will call
    // subscribe_output to attach a Channel after the session is created.
    let (handle, child) =
        pty_engine::spawn_session(session_id, &command_line, &project_dir, hook_port)?;

    let pid = handle.pid;
    let now = timestamp_now();

    // Build the session model.
    let session = Session {
        id: session_id,
        project_id,
        task: task.clone(),
        generated_name,
        status: SessionStatus::Running,
        last_message: None,
        created_at: now.clone(),
        last_started_at: Some(now),
        last_known_pid: pid,
        exit_code: None,
        exited_at: None,
    };

    // Store the session handle.
    {
        let mut handles = state.session_handles.write().await;
        handles.insert(session_id, handle);
    }

    // Store the session metadata and persist.
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id, session.clone());
    }
    state.persist().await?;

    // Start exit watcher thread.
    let state_clone = state.inner().clone();
    let app_handle = state.app_handle.read().await.clone()
        .expect("AppHandle not available");
    spawn_exit_watcher(session_id, child, state_clone, app_handle);

    Ok(session)
}

/// Delete a session from the project. Kills it first if still running.
#[tauri::command]
pub async fn delete_session(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<(), String> {
    // Kill if still alive
    {
        let mut handles = state.session_handles.write().await;
        if let Some(mut handle) = handles.remove(&session_id) {
            let _ = handle.killer.kill();
        }
    }

    // Remove from session metadata
    {
        let mut sessions = state.sessions.write().await;
        sessions.remove(&session_id);
    }
    state.persist().await?;
    Ok(())
}

/// Kill an active session by sending a signal to the PTY child.
#[tauri::command]
pub async fn kill_session(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<(), String> {
    // Kill via the ChildKiller.
    {
        let mut handles = state.session_handles.write().await;
        let handle = handles
            .get_mut(&session_id)
            .ok_or_else(|| format!("No active session handle for {}", session_id))?;
        handle
            .killer
            .kill()
            .map_err(|e| format!("Failed to kill session: {}", e))?;
    }

    // Mark session as exited. The exit watcher will also do this, but we
    // update eagerly so the UI is responsive.
    {
        let mut sessions = state.sessions.write().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.status = SessionStatus::Exited;
        }
    }
    state.persist().await?;

    Ok(())
}

/// Rename a session by updating its generated_name.
#[tauri::command]
pub async fn rename_session(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
    name: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Session name must not be empty".to_string());
    }
    if name.len() > 64 {
        return Err("Session name must be 64 characters or fewer".to_string());
    }

    {
        let mut sessions = state.sessions.write().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        session.generated_name = name;
    }
    state.persist().await?;

    Ok(())
}

/// Send UTF-8 input data to the PTY.
#[tauri::command]
pub async fn send_input(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
    data: String,
) -> Result<(), String> {
    let handles = state.session_handles.read().await;
    let handle = handles
        .get(&session_id)
        .ok_or_else(|| format!("No active session handle for {}", session_id))?;

    let mut writer = handle.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY writer: {}", e))?;

    Ok(())
}

/// Resize the PTY for the given session.
#[tauri::command]
pub async fn resize_pty(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let handles = state.session_handles.read().await;
    let handle = handles
        .get(&session_id)
        .ok_or_else(|| format!("No active session handle for {}", session_id))?;

    let master = handle.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;

    Ok(())
}

/// Return the current scrollback buffer for a session.
#[tauri::command]
pub async fn get_scrollback(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<Vec<u8>, String> {
    let handles = state.session_handles.read().await;
    let handle = handles
        .get(&session_id)
        .ok_or_else(|| format!("No active session handle for {}", session_id))?;

    let sb = handle.scrollback.lock().map_err(|e| e.to_string())?;
    Ok(sb.snapshot())
}

/// Atomically snapshot the scrollback buffer and attach a new output Channel.
/// Returns the scrollback bytes so the frontend can replay them before
/// receiving live output.
#[tauri::command]
pub async fn subscribe_output(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
    on_output: Channel<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let mut handles = state.session_handles.write().await;
    let handle = handles
        .get_mut(&session_id)
        .ok_or_else(|| format!("No active session handle for {}", session_id))?;

    let snapshot = handle.subscribe(on_output);
    Ok(snapshot)
}

/// Restart an exited session — reset scrollback, re-spawn with the same
/// identity (UUID, name), and update `last_started_at`.
#[tauri::command]
pub async fn restart_session(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<Session, String> {
    // Read session metadata.
    let (project_id, task, generated_name) = {
        let sessions = state.sessions.read().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        (
            session.project_id,
            session.task.clone(),
            session.generated_name.clone(),
        )
    };

    // Look up the project.
    let (command_template, project_dir) = {
        let projects = state.projects.read().await;
        let project = projects
            .get(&project_id)
            .ok_or_else(|| format!("Project {} not found", project_id))?;
        (project.command_template.clone(), project.path.clone())
    };

    if command_template.is_empty() {
        return Err("Project has no command template configured".to_string());
    }

    // Resolve the command template with the same identity.
    let command_line =
        crate::state::resolve_template(&command_template, &generated_name, &task, &project_dir);

    let hook_port = {
        let settings = state.settings.read().await;
        settings.hook_port
    };

    // Spawn a new PTY first, before removing old handle. This way if
    // spawn fails, the old handle remains in the map and can be cleaned up.
    let (handle, child) = pty_engine::spawn_session(
        session_id,
        &command_line,
        &project_dir,
        hook_port,
    )?;

    // Clean up old handle now that the new spawn succeeded.
    {
        let mut handles = state.session_handles.write().await;
        if let Some(mut old_handle) = handles.remove(&session_id) {
            if let Some(fh) = old_handle.forwarder_abort.take() {
                fh.abort();
            }
            let _ = old_handle.killer.kill();
        }
    }

    let pid = handle.pid;
    let now = timestamp_now();

    // Update session metadata.
    let session = {
        let mut sessions = state.sessions.write().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("Session {} not found after spawn", session_id))?;
        session.status = SessionStatus::Running;
        session.last_message = None;
        session.last_started_at = Some(now);
        session.last_known_pid = pid;
        session.clone()
    };

    // Store the new handle.
    {
        let mut handles = state.session_handles.write().await;
        handles.insert(session_id, handle);
    }

    state.persist().await?;

    // Start exit watcher.
    let state_clone = state.inner().clone();
    let app_handle = state.app_handle.read().await.clone()
        .expect("AppHandle not available");
    spawn_exit_watcher(session_id, child, state_clone, app_handle);

    Ok(session)
}

/// Spawn a thread that waits for the child process to exit, then updates
/// the session status and emits a Tauri event to the frontend.
fn spawn_exit_watcher(
    session_id: Uuid,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    state: Arc<AppState>,
    app_handle: tauri::AppHandle,
) {
    std::thread::Builder::new()
        .name(format!("exit-watcher-{}", &session_id.to_string()[..8]))
        .spawn(move || {
            // Block until the child exits.
            let exit_result = child.wait();

            // Extract exit code: Ok(status) -> status.exit_code() as i32,
            // Err(_) -> None.
            let exit_code = match &exit_result {
                Ok(status) => Some(status.exit_code() as i32),
                Err(_) => None,
            };
            let exited_at = timestamp_now();

            // Update session status to Exited and emit event.
            let rt = tokio::runtime::Handle::try_current();
            match rt {
                Ok(handle) => {
                    handle.block_on(async {
                        let project_id = {
                            let mut sessions = state.sessions.write().await;
                            if let Some(session) = sessions.get_mut(&session_id) {
                                session.status = SessionStatus::Exited;
                                session.exit_code = exit_code;
                                session.exited_at = Some(exited_at.clone());
                                Some(session.project_id)
                            } else {
                                None
                            }
                        };
                        let _ = state.persist().await;

                        // Emit session-exited event to the frontend.
                        if let Some(pid) = project_id {
                            let event_name = format!("session-exited-{}", session_id);
                            let mut payload = serde_json::json!({
                                "sessionId": session_id.to_string(),
                                "exitedAt": exited_at,
                            });
                            if let Some(code) = exit_code {
                                payload["exitCode"] = serde_json::json!(code);
                            }
                            let window_label = format!("project-{}", pid);
                            let _ = app_handle.emit_to(
                                tauri::EventTarget::labeled(window_label),
                                &event_name,
                                payload.clone(),
                            );
                            let _ = app_handle.emit(&event_name, payload);
                        }
                    });
                }
                Err(_) => {
                    eprintln!(
                        "exit-watcher: no tokio runtime for session {}",
                        session_id
                    );
                }
            }
        })
        .expect("Failed to spawn exit watcher thread");
}
