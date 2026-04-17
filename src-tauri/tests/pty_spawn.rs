// Live PTY tests that exercise spawn_session end-to-end. These verify the
// login-shell + stdin-injection behavior on the real OS. They are gated
// behind cfg(unix) since portable_pty only supports real shells there.

#![cfg(unix)]

use seance_lib::pty_engine::spawn_session;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Pull output from the scrollback buffer, waiting up to `timeout` for a
/// substring to appear. Returns the full accumulated output.
fn wait_for_output(
    scrollback: &std::sync::Arc<std::sync::Mutex<seance_lib::scrollback::ScrollbackBuffer>>,
    needle: &str,
    timeout: Duration,
) -> (bool, String) {
    let start = Instant::now();
    loop {
        let snapshot = {
            let sb = scrollback.lock().unwrap();
            sb.snapshot()
        };
        let text = String::from_utf8_lossy(&snapshot).to_string();
        if text.contains(needle) {
            return (true, text);
        }
        if start.elapsed() > timeout {
            return (false, text);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn spawn_session_with_command_runs_and_shell_stays_alive() {
    let id = Uuid::new_v4();
    // Use printf with a unique sentinel so we can detect the injected command ran.
    let sentinel = "__seance_cmd_marker_42__";
    let cmd = format!("printf '{}\\n'", sentinel);
    let (handle, mut child) =
        spawn_session(id, Some(&cmd), "/tmp", 0, "test-token").expect("spawn_session should succeed");

    let (found, text) = wait_for_output(&handle.scrollback, sentinel, Duration::from_secs(15));
    assert!(found, "expected sentinel '{}' in output, got:\n{}", sentinel, text);

    // Shell should still be alive shortly after the command runs — probe twice.
    std::thread::sleep(Duration::from_millis(500));
    assert!(
        child.try_wait().expect("try_wait").is_none(),
        "shell exited after injected command; expected it to stay alive"
    );

    // Cleanup.
    let mut killer = handle.killer;
    let _ = killer.kill();
    let _ = child.wait();
}

#[test]
fn spawn_session_without_command_gives_bare_shell() {
    let id = Uuid::new_v4();
    let (handle, mut child) =
        spawn_session(id, None, "/tmp", 0, "test-token").expect("spawn_session should succeed");

    // Give the shell a moment to start and render its prompt/init.
    std::thread::sleep(Duration::from_millis(1500));
    assert!(
        child.try_wait().expect("try_wait").is_none(),
        "bare shell should stay alive when no command is injected"
    );

    // Now inject a command via the writer, same way `send_input` would, and
    // verify it runs — confirming we got an interactive shell, not a no-op.
    let sentinel = "__seance_bare_marker_99__";
    {
        use std::io::Write;
        let mut w = handle.writer.lock().unwrap();
        w.write_all(format!("printf '{}\\n'\n", sentinel).as_bytes())
            .expect("write to shell stdin");
        w.flush().ok();
    }
    let (found, text) = wait_for_output(&handle.scrollback, sentinel, Duration::from_secs(15));
    assert!(found, "expected sentinel '{}' from bare shell, got:\n{}", sentinel, text);

    let mut killer = handle.killer;
    let _ = killer.kill();
    let _ = child.wait();
}

#[test]
fn spawn_session_with_empty_string_treated_as_none() {
    let id = Uuid::new_v4();
    let (handle, mut child) =
        spawn_session(id, Some(""), "/tmp", 0, "test-token").expect("spawn_session should succeed");

    std::thread::sleep(Duration::from_millis(1500));
    assert!(
        child.try_wait().expect("try_wait").is_none(),
        "shell should stay alive when command is Some(\"\")"
    );

    let mut killer = handle.killer;
    let _ = killer.kill();
    let _ = child.wait();
}

#[test]
fn spawn_session_sets_seance_env_vars() {
    let id = Uuid::new_v4();
    let token = "env-probe-token-xyz";
    let cmd = "printf 'SID=%s HP=%s HT=%s HU=%s\\n' \"$SEANCE_SESSION_ID\" \"$SEANCE_HOOK_PORT\" \"$SEANCE_HOOK_TOKEN\" \"$SEANCE_HOOK_URL\"";
    let (handle, mut child) =
        spawn_session(id, Some(cmd), "/tmp", 42424, token).expect("spawn_session should succeed");

    let expected = format!(
        "SID={} HP=42424 HT={} HU=http://127.0.0.1:42424/session/{}/status",
        id, token, id
    );
    let (found, text) = wait_for_output(&handle.scrollback, &expected, Duration::from_secs(15));
    assert!(
        found,
        "expected env-var echo '{}', got:\n{}",
        expected, text
    );

    let mut killer = handle.killer;
    let _ = killer.kill();
    let _ = child.wait();
}
