use crate::state::AppState;
use std::sync::Arc;

/// Send SIGHUP to a process group, wait 500ms, then SIGKILL any survivors.
///
/// Uses `killpg` to target the entire process group rooted at the given PID.
/// If `killpg` with SIGHUP fails (e.g., process already exited), we skip
/// the SIGKILL step for that PID.
fn kill_process_group(pid: i32) {
    unsafe {
        // Try to kill the entire process group.
        let hup_result = libc::killpg(pid, libc::SIGHUP);
        if hup_result != 0 {
            // Process group doesn't exist or we lack permission — try the
            // individual process as a fallback.
            let individual_result = libc::kill(pid, libc::SIGHUP);
            if individual_result != 0 {
                // Process is already gone — nothing to do.
                return;
            }
        }
    }

    // Grace period: 500ms for the process to shut down gracefully.
    std::thread::sleep(std::time::Duration::from_millis(500));

    unsafe {
        // Check if still alive (signal 0 = existence check).
        let alive = libc::kill(pid, 0) == 0;
        if alive {
            // Escalate to SIGKILL on the process group.
            let _ = libc::killpg(pid, libc::SIGKILL);
            // Fallback to individual kill if killpg fails.
            let _ = libc::kill(pid, libc::SIGKILL);
        }
    }
}

/// Kill all active PTY sessions tracked in state.
///
/// Iterates all session handles, extracts PIDs, sends SIGHUP then SIGKILL
/// after a grace period. This is called on app exit to clean up child
/// processes.
pub fn kill_all_sessions(state: &Arc<AppState>) {
    // Collect PIDs under the lock, then release the lock before killing.
    let pids: Vec<i32> = {
        let handles = state.session_handles.blocking_read();
        handles
            .values()
            .filter_map(|h| h.pid.and_then(|p| i32::try_from(p).ok()))
            .collect()
    };

    if pids.is_empty() {
        return;
    }

    // Send SIGHUP to all process groups first.
    for &pid in &pids {
        unsafe {
            let _ = libc::killpg(pid, libc::SIGHUP);
            // Fallback to individual process.
            let _ = libc::kill(pid, libc::SIGHUP);
        }
    }

    // Single grace period for all processes.
    std::thread::sleep(std::time::Duration::from_millis(500));

    // SIGKILL any survivors.
    for &pid in &pids {
        unsafe {
            let alive = libc::kill(pid, 0) == 0;
            if alive {
                let _ = libc::killpg(pid, libc::SIGKILL);
                let _ = libc::kill(pid, libc::SIGKILL);
            }
        }
    }
}

/// Check for orphaned processes from a previous run and kill them.
///
/// Reads all sessions that have a `last_known_pid` set, checks whether each
/// process is still alive, and kills any that are (they're orphans from a
/// crash or unclean exit).
pub fn cleanup_orphaned_processes(state: &Arc<AppState>) {
    let pids: Vec<i32> = {
        let sessions = state.sessions.blocking_read();
        sessions
            .values()
            .filter_map(|s| s.last_known_pid.and_then(|p| i32::try_from(p).ok()))
            .collect()
    };

    for pid in pids {
        unsafe {
            let alive = libc::kill(pid, 0) == 0;
            if alive {
                kill_process_group(pid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Persistence;

    fn make_test_state() -> Arc<AppState> {
        let dir = tempfile::tempdir().unwrap();
        let persistence = Persistence::new(dir.path());
        Arc::new(AppState::new_for_test(persistence))
    }

    #[test]
    fn test_kill_all_sessions_empty() {
        let state = make_test_state();
        // Should not panic with no sessions.
        kill_all_sessions(&state);
    }

    #[test]
    fn test_cleanup_orphaned_processes_empty() {
        let state = make_test_state();
        // Should not panic with no sessions.
        cleanup_orphaned_processes(&state);
    }

    #[test]
    fn test_kill_process_group_nonexistent_pid() {
        // Use a PID that almost certainly doesn't exist.
        // This should not panic — it gracefully handles ESRCH.
        kill_process_group(999_999_999);
    }
}
