use crate::models::SessionStatus;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use uuid::Uuid;

/// Shared state passed to all axum handlers.
#[derive(Clone)]
struct HookState {
    app_state: Arc<AppState>,
    app_handle: tauri::AppHandle,
}

/// Request body for status update POSTs from agent hooks.
#[derive(Debug, Deserialize)]
struct StatusUpdate {
    status: SessionStatus,
    message: Option<String>,
}

/// Event payload emitted to the frontend when a session status changes.
#[derive(Debug, Clone, Serialize)]
struct SessionStatusEvent {
    session_id: Uuid,
    status: SessionStatus,
    last_message: Option<String>,
}

/// Start the axum hook server on the given port.
///
/// Binds to `127.0.0.1:{port}`. On bind failure, logs the error and returns
/// without crashing — the app continues to function, just without hook-based
/// status updates.
pub async fn start_hook_server(state: Arc<AppState>, app_handle: tauri::AppHandle, port: u16) {
    let hook_state = HookState {
        app_state: state,
        app_handle,
    };

    let app = Router::new()
        .route("/session/{session_id}/status", post(handle_status))
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

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Hook server error: {}", e);
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
        assert_eq!(json["status"], "thinking");
        assert_eq!(json["last_message"], "Working on it");
    }
}
