use crate::models::SessionStatus;
use crate::state::AppState;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::watch;
use uuid::Uuid;

/// Shared state passed to all axum handlers.
#[derive(Clone)]
struct HookState {
    app_state: Arc<AppState>,
    app_handle: tauri::AppHandle,
    hook_token: String,
}

/// Request body for status update POSTs from agent hooks.
#[derive(Debug, Deserialize)]
struct StatusUpdate {
    status: SessionStatus,
    message: Option<String>,
}

/// Event payload emitted to the frontend when a session status changes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatusEvent {
    session_id: Uuid,
    status: SessionStatus,
    last_message: Option<String>,
}

/// Request body for working_dir update POSTs from agent hooks.
#[derive(Debug, Deserialize)]
struct WorkingDirUpdate {
    working_dir: String,
}

/// Event payload emitted when a session's working directory changes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionWorkingDirEvent {
    session_id: Uuid,
    working_dir: String,
    base_commit: Option<String>,
}

/// Start the axum hook server on the given port.
///
/// Binds to `127.0.0.1:{port}`. On bind failure, logs the error and returns
/// without crashing — the app continues to function, just without hook-based
/// status updates.
pub async fn start_hook_server(
    state: Arc<AppState>,
    app_handle: tauri::AppHandle,
    port: u16,
    mut shutdown_rx: watch::Receiver<()>,
) {
    let token = state.hook_token.clone();
    let hook_state = HookState {
        app_state: state,
        app_handle,
        hook_token: token,
    };

    let app = Router::new()
        .route("/session/{session_id}/status", post(handle_status))
        .route("/session/{session_id}/working_dir", post(handle_working_dir))
        .layer(middleware::from_fn_with_state(hook_state.clone(), auth_middleware))
        .with_state(hook_state);

    let addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Hook server failed to bind to {}: {}", addr, e);
            return;
        }
    };

    eprintln!("Hook server listening on {}", addr);

    let server = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.changed().await;
        });

    if let Err(e) = server.await {
        eprintln!("Hook server error: {}", e);
    }

    eprintln!("Hook server on port {} shut down", port);
}

/// Middleware that validates the `Authorization: Bearer <token>` header.
async fn auth_middleware(
    State(hook_state): State<HookState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());

    match auth_header {
        Some(value) if value.strip_prefix("Bearer ").map_or(false, |t| t == hook_state.hook_token) => {
            Ok(next.run(req).await)
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

/// Handler for `POST /session/{session_id}/status`.
///
/// Validates the session exists, rejects `exited` status (process-lifecycle only),
/// updates the session's status and last_message, persists state, and emits
/// Tauri events to the relevant project window and as a broadcast.
async fn handle_status(
    State(hook_state): State<HookState>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<StatusUpdate>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Reject attempts to set status to "exited" — that's process-lifecycle only
    if body.status == SessionStatus::Exited {
        return Err((
            StatusCode::BAD_REQUEST,
            "Cannot set status to 'exited' via hook — exited is process-lifecycle only".to_string(),
        ));
    }

    let project_id = {
        let mut sessions = hook_state.app_state.sessions.write().await;
        let session = sessions.get_mut(&session_id).ok_or((
            StatusCode::NOT_FOUND,
            format!("Session {} not found", session_id),
        ))?;

        session.status = body.status;
        session.last_message = body.message.clone();

        session.project_id
    };

    // Persist state (non-fatal if it fails)
    if let Err(e) = hook_state.app_state.persist().await {
        eprintln!("Failed to persist after hook status update: {}", e);
    }

    let event_payload = SessionStatusEvent {
        session_id,
        status: body.status,
        last_message: body.message,
    };

    let event_name = format!("session-status-{}", session_id);

    // Emit targeted event to the project window
    let window_label = format!("project-{}", project_id);
    let _ = hook_state
        .app_handle
        .emit_to(tauri::EventTarget::labeled(window_label), &event_name, event_payload.clone());

    // Emit broadcast so picker windows also get notified
    let _ = hook_state.app_handle.emit(&event_name, event_payload);

    Ok(StatusCode::OK)
}

/// Handler for `POST /session/{session_id}/working_dir`.
///
/// Validates the session exists, the new path is an existing directory under
/// the session's project path (containment check), updates working_dir,
/// re-records base_commit, persists state, and emits a Tauri event.
async fn handle_working_dir(
    State(hook_state): State<HookState>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<WorkingDirUpdate>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Validate the path is an existing directory.
    let new_path = std::path::Path::new(&body.working_dir);
    let canonical_new = std::fs::canonicalize(new_path).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("Path does not exist or is not accessible: {}", body.working_dir),
        )
    })?;
    if !canonical_new.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Path is not a directory: {}", body.working_dir),
        ));
    }

    // Look up the session and its project path for containment check.
    let project_id = {
        let sessions = hook_state.app_state.sessions.read().await;
        let session = sessions.get(&session_id).ok_or((
            StatusCode::NOT_FOUND,
            format!("Session {} not found", session_id),
        ))?;
        session.project_id
    };

    let project_path = {
        let projects = hook_state.app_state.projects.read().await;
        let project = projects.get(&project_id).ok_or((
            StatusCode::NOT_FOUND,
            format!("Project {} not found", project_id),
        ))?;
        project.path.clone()
    };

    // Containment check: new working_dir must be under project path.
    if let Ok(canonical_project) = std::fs::canonicalize(&project_path) {
        if !canonical_new.starts_with(&canonical_project) {
            return Err((
                StatusCode::BAD_REQUEST,
                "working_dir must be within the project directory".to_string(),
            ));
        }
    }

    // Resolve base_commit from the new working directory.
    let base_commit = crate::commands::sessions::resolve_base_commit_for_dir(
        canonical_new.to_str().unwrap_or(&body.working_dir),
    );

    // Update the session.
    {
        let mut sessions = hook_state.app_state.sessions.write().await;
        let session = sessions.get_mut(&session_id).ok_or((
            StatusCode::NOT_FOUND,
            format!("Session {} not found", session_id),
        ))?;
        session.working_dir = body.working_dir.clone();
        session.base_commit = base_commit.clone();
    }

    // Persist (non-fatal).
    if let Err(e) = hook_state.app_state.persist().await {
        eprintln!("Failed to persist after working_dir update: {}", e);
    }

    // Emit event.
    let event_payload = SessionWorkingDirEvent {
        session_id,
        working_dir: body.working_dir,
        base_commit,
    };
    let event_name = format!("session-working-dir-{}", session_id);
    let window_label = format!("project-{}", project_id);
    let _ = hook_state.app_handle.emit_to(
        tauri::EventTarget::labeled(window_label),
        &event_name,
        event_payload.clone(),
    );
    let _ = hook_state.app_handle.emit(&event_name, event_payload);

    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_update_deserialize_thinking() {
        let json = r#"{"status":"thinking"}"#;
        let update: StatusUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.status, SessionStatus::Thinking);
        assert!(update.message.is_none());
    }

    #[test]
    fn test_status_update_deserialize_with_message() {
        let json = r#"{"status":"waiting","message":"Waiting for user input"}"#;
        let update: StatusUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.status, SessionStatus::Waiting);
        assert_eq!(update.message.as_deref(), Some("Waiting for user input"));
    }

    #[test]
    fn test_status_update_deserialize_null_message() {
        let json = r#"{"status":"running","message":null}"#;
        let update: StatusUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.status, SessionStatus::Running);
        assert!(update.message.is_none());
    }

    #[test]
    fn test_status_update_deserialize_exited() {
        let json = r#"{"status":"exited"}"#;
        let update: StatusUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.status, SessionStatus::Exited);
    }

    #[test]
    fn test_status_update_deserialize_invalid_status() {
        let json = r#"{"status":"unknown_status"}"#;
        let result: Result<StatusUpdate, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_session_status_event_serialize() {
        let event = SessionStatusEvent {
            session_id: Uuid::nil(),
            status: SessionStatus::Thinking,
            last_message: Some("Working on it".to_string()),
        };
        let json = serde_json::to_value(&event).unwrap();
        // Verify camelCase serialization (matches frontend expectations)
        assert_eq!(json["sessionId"], "00000000-0000-0000-0000-000000000000");
        assert_eq!(json["status"], "thinking");
        assert_eq!(json["lastMessage"], "Working on it");
    }
}
