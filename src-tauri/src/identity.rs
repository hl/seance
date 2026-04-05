use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::process::Command;
use uuid::Uuid;

use crate::state::AppState;

/// Generate a human first name for a session via the Claude CLI.
///
/// On any failure (binary not found, timeout, parse error), returns a
/// placeholder in the format "Agent-{first 8 chars of UUID}".
pub async fn generate_name(session_id: Uuid) -> String {
    match try_generate_name().await {
        Ok(name) => name,
        Err(_) => placeholder_name(session_id),
    }
}

/// Attempt the Claude CLI call and extract the name from JSON output.
async fn try_generate_name() -> Result<String, String> {
    let result = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new("claude")
            .args([
                "-p",
                "Generate a unique human first name for an AI coding agent. Reply with just the name, nothing else.",
                "--model",
                "haiku",
                "--output-format",
                "json",
            ])
            .output(),
    )
    .await;

    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("Failed to spawn claude: {}", e)),
        Err(_) => return Err("Claude CLI timed out after 10s".to_string()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Claude CLI exited with error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_name_from_json(&stdout)
}

/// Parse the name from Claude CLI JSON output.
///
/// The `--output-format json` flag returns a JSON object with a `result`
/// field containing the text response.
fn parse_name_from_json(json_str: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))?;

    let name = value
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing 'result' field in JSON output".to_string())?;

    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Empty name returned".to_string());
    }

    Ok(name)
}

/// Generate the deterministic placeholder name from a UUID.
pub fn placeholder_name(session_id: Uuid) -> String {
    let uuid_str = session_id.to_string();
    format!("Agent-{}", &uuid_str[..8])
}

/// Returns true if a name is a placeholder (starts with "Agent-").
fn is_placeholder(name: &str) -> bool {
    name.starts_with("Agent-")
}

/// Generate a session name, and if it's a placeholder, schedule a background
/// retry that will update the session name in state and emit a Tauri event.
pub async fn generate_session_name(
    session_id: Uuid,
    state: Arc<AppState>,
    app_handle: tauri::AppHandle,
) -> String {
    let name = generate_name(session_id).await;

    if is_placeholder(&name) {
        schedule_retry(session_id, state, app_handle);
    }

    name
}

/// Maximum number of retry attempts for name generation.
const MAX_NAME_RETRIES: u32 = 3;

/// Spawn a background task that retries name generation up to MAX_NAME_RETRIES
/// times with exponential backoff. On success updates the session in AppState,
/// persists, and emits a Tauri event so the frontend can update.
fn schedule_retry(session_id: Uuid, state: Arc<AppState>, app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        for attempt in 0..MAX_NAME_RETRIES {
            let delay = Duration::from_secs(5 * (1 << attempt)); // 5s, 10s, 20s
            tokio::time::sleep(delay).await;

            if let Ok(name) = try_generate_name().await {
                let mut sessions = state.sessions.write().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.generated_name = name.clone();
                }
                drop(sessions);

                if let Err(e) = state.persist().await {
                    eprintln!("Failed to persist after name retry: {}", e);
                }

                let event_name = format!("session-name-updated-{}", session_id);
                let _ = app_handle.emit(&event_name, name);
                return; // Success — stop retrying
            }
        }
        // All retries exhausted — placeholder name stays
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_placeholder_name_format() {
        let id = Uuid::parse_str("a1b2c3d4-e5f6-7890-abcd-ef1234567890").unwrap();
        let name = placeholder_name(id);
        assert_eq!(name, "Agent-a1b2c3d4");
    }

    #[test]
    fn test_placeholder_name_is_8_chars_after_prefix() {
        let id = Uuid::new_v4();
        let name = placeholder_name(id);
        assert!(name.starts_with("Agent-"));
        // "Agent-" is 6 chars, plus 8 UUID chars = 14 total
        assert_eq!(name.len(), 14);
    }

    #[test]
    fn test_is_placeholder_detects_placeholder() {
        assert!(is_placeholder("Agent-a1b2c3d4"));
        assert!(!is_placeholder("Maya"));
        assert!(!is_placeholder("agent-lowercase"));
    }

    #[test]
    fn test_parse_name_from_valid_json() {
        let json = r#"{"type":"result","subtype":"success","result":"Maya","duration_ms":500}"#;
        let name = parse_name_from_json(json).unwrap();
        assert_eq!(name, "Maya");
    }

    #[test]
    fn test_parse_name_trims_whitespace() {
        let json = r#"{"result":"  Luna  "}"#;
        let name = parse_name_from_json(json).unwrap();
        assert_eq!(name, "Luna");
    }

    #[test]
    fn test_parse_name_from_missing_result_field() {
        let json = r#"{"type":"error","message":"something went wrong"}"#;
        let result = parse_name_from_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_name_from_invalid_json() {
        let result = parse_name_from_json("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_name_from_empty_result() {
        let json = r#"{"result":""}"#;
        let result = parse_name_from_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_name_from_whitespace_only_result() {
        let json = r#"{"result":"   "}"#;
        let result = parse_name_from_json(json);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_generate_name_fallback_when_cli_unavailable() {
        // This test relies on `claude` not being available in the test env,
        // or at minimum validates the fallback path. In CI where `claude`
        // is not installed, this will always hit the placeholder path.
        // We test the fallback mechanism directly instead.
        let id = Uuid::parse_str("deadbeef-1234-5678-9abc-def012345678").unwrap();
        let placeholder = placeholder_name(id);
        assert_eq!(placeholder, "Agent-deadbeef");
    }
}
