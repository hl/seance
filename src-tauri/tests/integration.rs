// Integration tests that exercise the AppState layer directly,
// simulating what Tauri commands do without requiring a running app.

use seance_lib::models::{
    AppSettings, PersistedState, Project, Session, SessionStatus,
};
use seance_lib::persistence::Persistence;
use seance_lib::pty_engine::validate_task_slug;
use seance_lib::scrollback::ScrollbackBuffer;
use seance_lib::state::{resolve_template, AppState};
use tempfile::tempdir;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_project(path: &str, template: &str) -> Project {
    Project {
        id: Uuid::new_v4(),
        path: path.to_string(),
        command_template: template.to_string(),
        created_at: "1000000".to_string(),
    }
}

fn make_session(project_id: Uuid, status: SessionStatus) -> Session {
    Session {
        id: Uuid::new_v4(),
        project_id,
        task: "fix-bug".to_string(),
        generated_name: "Agent-abc12345".to_string(),
        status,
        last_message: None,
        created_at: "1000000".to_string(),
        last_started_at: Some("1000000".to_string()),
        last_known_pid: None,
    }
}

fn new_state() -> AppState {
    let dir = tempdir().unwrap();
    let persistence = Persistence::new(dir.path());
    // Leak the tempdir so the directory lives for the duration of the test.
    // This is fine in tests — the OS cleans temp files on reboot.
    std::mem::forget(dir);
    AppState::new_for_test(persistence)
}

// ---------------------------------------------------------------------------
// 1. Project lifecycle
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_add_list_update_remove() {
    let state = new_state();

    // Add a project.
    let project = make_project("/tmp/myproject", "claude -w {{task}}");
    let project_id = project.id;
    {
        let mut projects = state.projects.write().await;
        projects.insert(project.id, project.clone());
    }

    // Verify it is present.
    {
        let projects = state.projects.read().await;
        assert_eq!(projects.len(), 1);
        assert!(projects.contains_key(&project_id));
        assert_eq!(projects[&project_id].path, "/tmp/myproject");
    }

    // Update command_template.
    {
        let mut projects = state.projects.write().await;
        let p = projects.get_mut(&project_id).unwrap();
        p.command_template = "new-cmd {{task}}".to_string();
    }
    {
        let projects = state.projects.read().await;
        assert_eq!(projects[&project_id].command_template, "new-cmd {{task}}");
    }

    // Add a session for this project, then remove the project.
    let session = make_session(project_id, SessionStatus::Running);
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session.id, session);
    }

    // Remove the project and its sessions (mirrors remove_project command).
    {
        let mut projects = state.projects.write().await;
        assert!(projects.remove(&project_id).is_some());
    }
    {
        let mut sessions = state.sessions.write().await;
        sessions.retain(|_, s| s.project_id != project_id);
    }

    // Verify both are gone.
    {
        let projects = state.projects.read().await;
        assert!(projects.is_empty());
    }
    {
        let sessions = state.sessions.read().await;
        assert!(sessions.is_empty());
    }
}

#[tokio::test]
async fn project_persist_and_reload() {
    let dir = tempdir().unwrap();
    let project_id;

    // Create state, add a project, persist.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let project = make_project("/tmp/roundtrip", "echo {{task}}");
        project_id = project.id;
        {
            let mut projects = state.projects.write().await;
            projects.insert(project.id, project);
        }
        state.persist().await.unwrap();
    }

    // Reload from disk.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let projects = state.projects.read().await;
        assert_eq!(projects.len(), 1);
        assert!(projects.contains_key(&project_id));
        assert_eq!(projects[&project_id].path, "/tmp/roundtrip");
        assert_eq!(projects[&project_id].command_template, "echo {{task}}");
    }
}

// ---------------------------------------------------------------------------
// 2. Session lifecycle
// ---------------------------------------------------------------------------

#[tokio::test]
async fn session_active_count_excludes_exited_and_done() {
    let state = new_state();

    let project = make_project("/tmp/p", "cmd");
    let pid = project.id;
    {
        let mut projects = state.projects.write().await;
        projects.insert(pid, project);
    }

    // Add sessions with various statuses.
    let s_running = make_session(pid, SessionStatus::Running);
    let s_thinking = make_session(pid, SessionStatus::Thinking);
    let s_waiting = make_session(pid, SessionStatus::Waiting);
    let s_exited = make_session(pid, SessionStatus::Exited);
    let s_done = make_session(pid, SessionStatus::Done);
    let s_error = make_session(pid, SessionStatus::Error);

    {
        let mut sessions = state.sessions.write().await;
        for s in [&s_running, &s_thinking, &s_waiting, &s_exited, &s_done, &s_error] {
            sessions.insert(s.id, s.clone());
        }
    }

    // Count active (anything other than Exited or Done).
    let active_count = {
        let sessions = state.sessions.read().await;
        sessions
            .values()
            .filter(|s| s.project_id == pid)
            .filter(|s| !matches!(s.status, SessionStatus::Exited | SessionStatus::Done))
            .count()
    };

    // Running, Thinking, Waiting, Error = 4 active.
    assert_eq!(active_count, 4);
}

#[tokio::test]
async fn session_status_change_to_exited() {
    let state = new_state();

    let project = make_project("/tmp/p", "cmd");
    let pid = project.id;
    {
        let mut projects = state.projects.write().await;
        projects.insert(pid, project);
    }

    let session = make_session(pid, SessionStatus::Running);
    let sid = session.id;
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(sid, session);
    }

    // Transition to Exited.
    {
        let mut sessions = state.sessions.write().await;
        sessions.get_mut(&sid).unwrap().status = SessionStatus::Exited;
    }

    let active_count = {
        let sessions = state.sessions.read().await;
        sessions
            .values()
            .filter(|s| s.project_id == pid)
            .filter(|s| !matches!(s.status, SessionStatus::Exited | SessionStatus::Done))
            .count()
    };
    assert_eq!(active_count, 0);
}

#[tokio::test]
async fn session_loads_as_exited_after_roundtrip() {
    let dir = tempdir().unwrap();
    let session_id;

    // Persist a session that is Running.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let project = make_project("/tmp/p", "cmd");
        let pid = project.id;
        {
            let mut projects = state.projects.write().await;
            projects.insert(pid, project);
        }

        let mut session = make_session(pid, SessionStatus::Running);
        session.last_message = Some("thinking about stuff".to_string());
        session_id = session.id;
        {
            let mut sessions = state.sessions.write().await;
            sessions.insert(session_id, session);
        }
        state.persist().await.unwrap();
    }

    // Reload — R29 says sessions always load as Exited.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let sessions = state.sessions.read().await;
        let s = sessions.get(&session_id).unwrap();
        assert_eq!(s.status, SessionStatus::Exited);
        // last_message is also cleared on load.
        assert!(s.last_message.is_none());
    }
}

// ---------------------------------------------------------------------------
// 3. Template resolution
// ---------------------------------------------------------------------------

#[test]
fn template_all_placeholders() {
    let result = resolve_template(
        "claude -w {{task}} --name {{session_name}} --dir {{project_dir}}",
        "Maya",
        "fix-auth",
        "/home/user/project",
    );
    assert_eq!(
        result,
        "claude -w fix-auth --name Maya --dir /home/user/project"
    );
}

#[test]
fn template_no_placeholders() {
    let result = resolve_template("simple command", "Maya", "fix", "/tmp");
    assert_eq!(result, "simple command");
}

#[test]
fn template_unknown_placeholder_passthrough() {
    let result = resolve_template("cmd {{task}} {{unknown}}", "Maya", "fix", "/tmp");
    assert_eq!(result, "cmd fix {{unknown}}");
}

#[test]
fn template_repeated_placeholders() {
    let result = resolve_template(
        "{{task}} and {{task}} again",
        "Maya",
        "deploy",
        "/tmp",
    );
    assert_eq!(result, "deploy and deploy again");
}

#[test]
fn template_empty_string() {
    let result = resolve_template("", "Maya", "fix", "/tmp");
    assert_eq!(result, "");
}

#[test]
fn template_only_placeholders() {
    let result = resolve_template(
        "{{session_name}}{{task}}{{project_dir}}",
        "Bot",
        "run",
        "/dir",
    );
    assert_eq!(result, "Botrun/dir");
}

#[test]
fn template_special_chars_in_values() {
    // Values with spaces, special chars should pass through literally.
    let result = resolve_template(
        "cmd --dir {{project_dir}}",
        "Maya",
        "fix",
        "/home/user/my project (copy)",
    );
    assert_eq!(result, "cmd --dir /home/user/my project (copy)");
}

// ---------------------------------------------------------------------------
// 4. Scrollback buffer integration
// ---------------------------------------------------------------------------

#[test]
fn scrollback_realistic_terminal_data() {
    let mut sb = ScrollbackBuffer::new();

    // Mix of plain text and ANSI escape sequences.
    sb.append(b"\x1b[32mOK\x1b[0m: tests passed\r\n");
    sb.append(b"line 2: regular text\r\n");
    sb.append(b"\x1b[1;31merror\x1b[0m: something failed\r\n");

    let snap = sb.snapshot();
    let text = String::from_utf8_lossy(&snap);
    assert!(text.contains("OK"));
    assert!(text.contains("tests passed"));
    assert!(text.contains("error"));
    assert!(text.contains("something failed"));
}

#[test]
fn scrollback_small_cap_trims() {
    let mut sb = ScrollbackBuffer::with_cap(100);

    // Write 150 bytes of data in neat lines.
    for i in 0..15 {
        sb.append(format!("line-{:04}\n", i).as_bytes()); // 10 bytes each = 150 total
    }

    assert!(sb.len() <= 100, "buffer should be at or under cap, was {}", sb.len());

    // All remaining lines should be intact.
    let snap = sb.snapshot();
    let text = String::from_utf8(snap).unwrap();
    for line in text.lines() {
        assert!(
            line.starts_with("line-"),
            "each line should be intact: got '{}'",
            line
        );
    }
    // The latest line should always survive.
    assert!(text.contains("line-0014"));
}

#[test]
fn scrollback_reset_and_verify_empty() {
    let mut sb = ScrollbackBuffer::new();
    sb.append(b"some data\nanother line\n");
    assert!(!sb.snapshot().is_empty());

    sb.reset();
    assert!(sb.snapshot().is_empty());
    assert_eq!(sb.len(), 0);

    // Can append again after reset.
    sb.append(b"fresh data\n");
    assert_eq!(sb.snapshot(), b"fresh data\n");
}

#[test]
fn scrollback_exact_cap_no_trim() {
    let mut sb = ScrollbackBuffer::with_cap(10);
    sb.append(b"0123456789"); // exactly 10 bytes = cap
    assert_eq!(sb.len(), 10);
    assert_eq!(sb.snapshot(), b"0123456789");
}

#[test]
fn scrollback_empty_append_noop() {
    let mut sb = ScrollbackBuffer::new();
    sb.append(b"data");
    sb.append(b"");
    assert_eq!(sb.snapshot(), b"data");
}

// ---------------------------------------------------------------------------
// 5. Task slug validation edge cases
// ---------------------------------------------------------------------------

#[test]
fn task_slug_valid_cases() {
    assert!(validate_task_slug("a").is_ok());
    assert!(validate_task_slug("abc").is_ok());
    assert!(validate_task_slug("fix-bug").is_ok());
    assert!(validate_task_slug("feature-123").is_ok());
    assert!(validate_task_slug("a-b-c-d").is_ok());
    assert!(validate_task_slug("123").is_ok());
    assert!(validate_task_slug("x").is_ok());
}

#[test]
fn task_slug_invalid_empty() {
    let err = validate_task_slug("").unwrap_err();
    assert!(err.contains("empty"), "error should mention empty: {}", err);
}

#[test]
fn task_slug_invalid_uppercase() {
    assert!(validate_task_slug("A").is_err());
    assert!(validate_task_slug("Fix-Bug").is_err());
    assert!(validate_task_slug("ALLCAPS").is_err());
}

#[test]
fn task_slug_invalid_spaces() {
    assert!(validate_task_slug("fix bug").is_err());
    assert!(validate_task_slug(" leading").is_err());
    assert!(validate_task_slug("trailing ").is_err());
}

#[test]
fn task_slug_invalid_leading_trailing_hyphen() {
    let err_leading = validate_task_slug("-leading").unwrap_err();
    assert!(err_leading.contains("hyphen"), "should mention hyphen: {}", err_leading);

    let err_trailing = validate_task_slug("trailing-").unwrap_err();
    assert!(err_trailing.contains("hyphen"), "should mention hyphen: {}", err_trailing);
}

#[test]
fn task_slug_invalid_special_chars() {
    assert!(validate_task_slug("under_score").is_err());
    assert!(validate_task_slug("dot.dot").is_err());
    assert!(validate_task_slug("slash/slash").is_err());
    assert!(validate_task_slug("at@sign").is_err());
    assert!(validate_task_slug("hash#tag").is_err());
}

// ---------------------------------------------------------------------------
// 6. Persistence crash resilience
// ---------------------------------------------------------------------------

#[test]
fn persistence_corrupt_file_returns_defaults() {
    let dir = tempdir().unwrap();
    let persistence = Persistence::new(dir.path());

    // Save valid state first.
    let mut state = PersistedState::default();
    state.projects.push(make_project("/tmp/p", "cmd"));
    persistence.save(&state).unwrap();

    // Corrupt the file.
    std::fs::write(dir.path().join("seance-data.json"), "{{{{not json!!!!").unwrap();

    // Load should return defaults, not error.
    let loaded = persistence.load();
    assert!(loaded.projects.is_empty());
    assert!(loaded.sessions.is_empty());
    assert_eq!(loaded.settings.hook_port, 7837);
}

#[test]
fn persistence_missing_file_returns_defaults() {
    let dir = tempdir().unwrap();
    let persistence = Persistence::new(dir.path());

    // Don't save anything — file doesn't exist.
    let loaded = persistence.load();
    assert!(loaded.projects.is_empty());
    assert!(loaded.sessions.is_empty());
    assert_eq!(loaded.settings.hook_port, 7837);
}

#[test]
fn persistence_deleted_file_returns_defaults() {
    let dir = tempdir().unwrap();
    let persistence = Persistence::new(dir.path());

    // Save, then delete.
    let state = PersistedState::default();
    persistence.save(&state).unwrap();
    assert!(dir.path().join("seance-data.json").exists());

    std::fs::remove_file(dir.path().join("seance-data.json")).unwrap();

    let loaded = persistence.load();
    assert!(loaded.projects.is_empty());
}

#[test]
fn persistence_no_tmp_file_left_after_save() {
    let dir = tempdir().unwrap();
    let persistence = Persistence::new(dir.path());

    let state = PersistedState::default();
    persistence.save(&state).unwrap();

    // The atomic write uses a .tmp file that should be renamed away.
    assert!(!dir.path().join("seance-data.json.tmp").exists());
    assert!(dir.path().join("seance-data.json").exists());
}

// ---------------------------------------------------------------------------
// 7. Settings validation
// ---------------------------------------------------------------------------

#[test]
fn default_settings_correct_values() {
    let settings = AppSettings::default();
    assert_eq!(settings.hook_port, 7837);
    assert_eq!(settings.terminal_font_size, 14);
    assert_eq!(settings.terminal_theme, "system");
}

#[tokio::test]
async fn settings_persist_and_reload() {
    let dir = tempdir().unwrap();

    // Save custom settings.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        {
            let mut settings = state.settings.write().await;
            settings.hook_port = 9999;
            settings.terminal_font_size = 18;
            settings.terminal_theme = "dark".to_string();
        }
        state.persist().await.unwrap();
    }

    // Reload and verify.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let settings = state.settings.read().await;
        assert_eq!(settings.hook_port, 9999);
        assert_eq!(settings.terminal_font_size, 18);
        assert_eq!(settings.terminal_theme, "dark");
    }
}

#[test]
fn settings_deserialized_with_missing_fields_get_defaults() {
    // Simulate loading a JSON file that only has partial settings.
    let json = r#"{"projects":[],"sessions":[],"settings":{}}"#;
    let state: PersistedState = serde_json::from_str(json).unwrap();
    assert_eq!(state.settings.hook_port, 7837);
    assert_eq!(state.settings.terminal_font_size, 14);
    assert_eq!(state.settings.terminal_theme, "system");
}

// ---------------------------------------------------------------------------
// 8. Project-session association (cascade removal)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn removing_project_only_removes_its_sessions() {
    let state = new_state();

    let project_a = make_project("/tmp/a", "cmd-a");
    let project_b = make_project("/tmp/b", "cmd-b");
    let pid_a = project_a.id;
    let pid_b = project_b.id;

    {
        let mut projects = state.projects.write().await;
        projects.insert(pid_a, project_a);
        projects.insert(pid_b, project_b);
    }

    // Add sessions to both projects.
    let sa1 = make_session(pid_a, SessionStatus::Running);
    let sa2 = make_session(pid_a, SessionStatus::Exited);
    let sb1 = make_session(pid_b, SessionStatus::Running);
    let sb2 = make_session(pid_b, SessionStatus::Thinking);
    let sb1_id = sb1.id;
    let sb2_id = sb2.id;

    {
        let mut sessions = state.sessions.write().await;
        for s in [sa1, sa2, sb1, sb2] {
            sessions.insert(s.id, s);
        }
    }

    // Verify 4 total sessions.
    {
        let sessions = state.sessions.read().await;
        assert_eq!(sessions.len(), 4);
    }

    // Remove project A and its sessions.
    {
        let mut projects = state.projects.write().await;
        projects.remove(&pid_a);
    }
    {
        let mut sessions = state.sessions.write().await;
        sessions.retain(|_, s| s.project_id != pid_a);
    }

    // Verify project A is gone.
    {
        let projects = state.projects.read().await;
        assert_eq!(projects.len(), 1);
        assert!(projects.contains_key(&pid_b));
    }

    // Verify only project B's sessions remain.
    {
        let sessions = state.sessions.read().await;
        assert_eq!(sessions.len(), 2);
        assert!(sessions.contains_key(&sb1_id));
        assert!(sessions.contains_key(&sb2_id));
        for s in sessions.values() {
            assert_eq!(s.project_id, pid_b);
        }
    }
}

#[tokio::test]
async fn removing_project_with_no_sessions_is_fine() {
    let state = new_state();

    let project = make_project("/tmp/lonely", "cmd");
    let pid = project.id;
    {
        let mut projects = state.projects.write().await;
        projects.insert(pid, project);
    }

    // Remove — no sessions to cascade-remove, should not error.
    {
        let mut projects = state.projects.write().await;
        assert!(projects.remove(&pid).is_some());
    }
    {
        let mut sessions = state.sessions.write().await;
        sessions.retain(|_, s| s.project_id != pid);
    }

    let projects = state.projects.read().await;
    assert!(projects.is_empty());
}

#[tokio::test]
async fn full_end_to_end_persist_cycle() {
    // Create two projects with sessions, persist, reload, verify everything.
    let dir = tempdir().unwrap();
    let pid_a;
    let pid_b;
    let sid_a;
    let sid_b;

    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let project_a = make_project("/tmp/alpha", "cmd-a {{task}}");
        let project_b = make_project("/tmp/beta", "cmd-b {{session_name}}");
        pid_a = project_a.id;
        pid_b = project_b.id;

        {
            let mut projects = state.projects.write().await;
            projects.insert(pid_a, project_a);
            projects.insert(pid_b, project_b);
        }

        let session_a = make_session(pid_a, SessionStatus::Running);
        let session_b = make_session(pid_b, SessionStatus::Waiting);
        sid_a = session_a.id;
        sid_b = session_b.id;

        {
            let mut sessions = state.sessions.write().await;
            sessions.insert(sid_a, session_a);
            sessions.insert(sid_b, session_b);
        }

        // Custom settings.
        {
            let mut settings = state.settings.write().await;
            settings.hook_port = 4242;
        }

        state.persist().await.unwrap();
    }

    // Reload.
    {
        let persistence = Persistence::new(dir.path());
        let state = AppState::new_for_test(persistence);

        let projects = state.projects.read().await;
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[&pid_a].path, "/tmp/alpha");
        assert_eq!(projects[&pid_b].path, "/tmp/beta");

        let sessions = state.sessions.read().await;
        assert_eq!(sessions.len(), 2);
        // Both should be Exited after reload (R29).
        assert_eq!(sessions[&sid_a].status, SessionStatus::Exited);
        assert_eq!(sessions[&sid_b].status, SessionStatus::Exited);

        let settings = state.settings.read().await;
        assert_eq!(settings.hook_port, 4242);
    }
}
