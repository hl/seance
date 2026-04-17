use crate::models::{Session, SessionStatus};
use crate::pty_engine::{self, validate_task_slug};
use crate::state::AppState;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::Emitter;
use uuid::Uuid;

/// Run `git rev-parse HEAD` in the given directory and return the SHA if it
/// looks valid (40-char hex). Returns None for non-git dirs or unexpected output.
/// Public alias for use by the hook server.
pub fn resolve_base_commit_for_dir(dir: &str) -> Option<String> {
    resolve_base_commit(dir)
}

fn resolve_base_commit(dir: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Validate 40-char hex SHA to prevent argument injection
    if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(sha)
    } else {
        None
    }
}

use crate::state::timestamp_now;

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

    // Generate session identity — deterministic name from UUID.
    let session_id = Uuid::new_v4();
    let generated_name = crate::identity::default_name(session_id);

    // Resolve the command template only when non-empty (whitespace-only counts as empty).
    let command_line = if command_template.trim().is_empty() {
        None
    } else {
        Some(crate::state::resolve_template(
            &command_template,
            &generated_name,
            &task,
            &project_dir,
        ))
    };

    // Read the hook port from settings.
    let hook_port = {
        let settings = state.settings.read().await;
        settings.hook_port
    };
    let hook_token = &state.hook_token;

    // Spawn the PTY. No Channel yet — the Terminal component will call
    // subscribe_output to attach a Channel after the session is created.
    let (handle, child) = pty_engine::spawn_session(
        session_id,
        command_line.as_deref(),
        &project_dir,
        hook_port,
        hook_token,
    )?;

    let pid = handle.pid;
    let now = timestamp_now();

    // Record the base commit before building the session model.
    let base_commit = resolve_base_commit(&project_dir);

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
        working_dir: project_dir.clone(),
        base_commit,
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
        .ok_or_else(|| "AppHandle not available".to_string())?;
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

    // Clean up exited scrollback snapshot
    {
        let mut exited = state.exited_scrollback.write().await;
        exited.remove(&session_id);
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
    // Try the live handle first.
    {
        let handles = state.session_handles.read().await;
        if let Some(handle) = handles.get(&session_id) {
            let sb = handle.scrollback.lock().map_err(|e| e.to_string())?;
            return Ok(sb.snapshot());
        }
    }
    // Fall back to the exited scrollback snapshot.
    let exited = state.exited_scrollback.read().await;
    Ok(exited.get(&session_id).cloned().unwrap_or_default())
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
    // Try the live handle first.
    {
        let mut handles = state.session_handles.write().await;
        if let Some(handle) = handles.get_mut(&session_id) {
            let snapshot = handle.subscribe(on_output);
            return Ok(snapshot);
        }
    }
    // For exited sessions, return the snapshot (no live channel needed).
    let exited = state.exited_scrollback.read().await;
    Ok(exited.get(&session_id).cloned().unwrap_or_default())
}

/// Restart an exited session — reset scrollback, re-spawn with the same
/// identity (UUID, name), and update `last_started_at`.
#[tauri::command]
pub async fn restart_session(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<Session, String> {
    // Read session metadata (including working_dir for base_commit resolution).
    let (project_id, task, generated_name, session_working_dir) = {
        let sessions = state.sessions.read().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        if !matches!(session.status, SessionStatus::Exited | SessionStatus::Done | SessionStatus::Error) {
            return Err("Session is still running".to_string());
        }
        (
            session.project_id,
            session.task.clone(),
            session.generated_name.clone(),
            session.working_dir.clone(),
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

    // Resolve the command template only when non-empty (whitespace-only counts as empty).
    let command_line = if command_template.trim().is_empty() {
        None
    } else {
        Some(crate::state::resolve_template(
            &command_template,
            &generated_name,
            &task,
            &project_dir,
        ))
    };

    let hook_port = {
        let settings = state.settings.read().await;
        settings.hook_port
    };
    let hook_token = &state.hook_token;

    // Spawn a new PTY first, before removing old handle. This way if
    // spawn fails, the old handle remains in the map and can be cleaned up.
    let (handle, child) = pty_engine::spawn_session(
        session_id,
        command_line.as_deref(),
        &project_dir,
        hook_port,
        hook_token,
    )?;

    // Clean up old handle and exited scrollback now that the new spawn succeeded.
    {
        let mut handles = state.session_handles.write().await;
        if let Some(mut old_handle) = handles.remove(&session_id) {
            if let Some(fh) = old_handle.forwarder_abort.take() {
                fh.abort();
            }
            let _ = old_handle.killer.kill();
        }
    }
    {
        let mut exited = state.exited_scrollback.write().await;
        exited.remove(&session_id);
    }

    let pid = handle.pid;
    let now = timestamp_now();

    // Re-record base_commit from the session's current working_dir (not project_dir —
    // it may have been updated via hook server).
    let effective_dir = if session_working_dir.is_empty() {
        &project_dir
    } else {
        &session_working_dir
    };
    let base_commit = resolve_base_commit(effective_dir);

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
        session.exit_code = None;
        session.exited_at = None;
        session.base_commit = base_commit;
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
        .ok_or_else(|| "AppHandle not available".to_string())?;
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
    let _ = std::thread::Builder::new()
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

                        // Snapshot scrollback and release the heavy SessionHandle.
                        {
                            let mut handles = state.session_handles.write().await;
                            if let Some(handle) = handles.remove(&session_id) {
                                let snapshot = {
                                    let sb = handle.scrollback.lock()
                                        .unwrap_or_else(|e| e.into_inner());
                                    sb.snapshot()
                                };
                                state.exited_scrollback.write().await
                                    .insert(session_id, snapshot);
                            }
                        }

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
        });
}
