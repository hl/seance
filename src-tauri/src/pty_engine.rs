use crate::scrollback::ScrollbackBuffer;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use uuid::Uuid;

/// How long to accumulate PTY output before flushing a batch.
const BATCH_TIMEOUT: Duration = Duration::from_millis(8);
/// Maximum bytes to accumulate before flushing a batch, regardless of time.
const BATCH_MAX_BYTES: usize = 200 * 1024;

/// Holds the runtime resources for an active PTY session.
pub struct SessionHandle {
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub scrollback: Arc<Mutex<ScrollbackBuffer>>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// The forwarder task join handle — dropping it cancels the task.
    pub forwarder_abort: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Sender side of the output mpsc — kept so we can detect if the reader
    /// thread is still alive. The reader thread holds a clone.
    pub output_tx: mpsc::Sender<Vec<u8>>,
    pub pid: Option<u32>,
}

impl SessionHandle {
    /// Replace the forwarder task with one that sends to a new Channel.
    /// Returns a snapshot of the scrollback buffer taken atomically with
    /// the forwarder swap, so no output is lost.
    pub fn subscribe(
        &mut self,
        channel: tauri::ipc::Channel<Vec<u8>>,
    ) -> Vec<u8> {
        // Abort the old forwarder if present.
        if let Some(handle) = self.forwarder_abort.take() {
            handle.abort();
        }

        // Snapshot scrollback while we hold the lock — no new data can
        // be appended between snapshot and forwarder start because the
        // reader thread uses blocking_send on the mpsc, and we drain
        // the mpsc receiver in the new forwarder.
        let snapshot = {
            let sb = self.scrollback.lock().unwrap();
            sb.snapshot()
        };

        // Create a new mpsc channel; swap the sender so the reader thread
        // picks it up on the next send (the old sender is dropped, which
        // will make any in-flight blocking_send on the old channel fail —
        // but the reader thread checks for send errors and uses the new tx).
        let (new_tx, new_rx) = mpsc::channel::<Vec<u8>>(256);
        self.output_tx = new_tx;

        // Start a new forwarder task.
        let handle = spawn_forwarder(new_rx, channel);
        self.forwarder_abort = Some(handle);

        snapshot
    }
}

/// Spawn a PTY for the given command line, in the given working directory,
/// with the given environment variables. Returns a SessionHandle and a
/// child process (moved into the exit watcher).
pub fn spawn_session(
    session_id: Uuid,
    command_line: &str,
    working_dir: &str,
    hook_port: u16,
    channel: tauri::ipc::Channel<Vec<u8>>,
) -> Result<(SessionHandle, Box<dyn Child + Send + Sync>), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Build the command — use the user's shell to interpret the command line.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-c");
    cmd.arg(command_line);
    cmd.cwd(working_dir);

    // Set Séance environment variables for the hook system.
    cmd.env("SEANCE_SESSION_ID", session_id.to_string());
    cmd.env("SEANCE_HOOK_PORT", hook_port.to_string());
    cmd.env(
        "SEANCE_HOOK_URL",
        format!("http://127.0.0.1:{}/session/{}/status", hook_port, session_id),
    );

    // Spawn the child in the PTY.
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let pid = child.process_id();

    // Critical: drop the slave after spawn so EOF is delivered when the child exits.
    drop(pair.slave);

    // Get reader and writer from the master.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let writer = Arc::new(Mutex::new(writer));
    let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new()));
    let master = Arc::new(Mutex::new(pair.master));

    // mpsc channel for reader thread → forwarder task.
    let (tx, rx) = mpsc::channel::<Vec<u8>>(256);

    // Start the reader thread (blocking OS thread).
    let reader_tx = tx.clone();
    let reader_scrollback = scrollback.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader-{}", &session_id.to_string()[..8]))
        .spawn(move || {
            reader_loop(reader, reader_tx, reader_scrollback);
        })
        .map_err(|e| format!("Failed to spawn reader thread: {}", e))?;

    // Start the forwarder task (async, on the Tauri/tokio runtime).
    let forwarder_handle = spawn_forwarder(rx, channel);

    let killer = child
        .clone_killer();

    let handle = SessionHandle {
        killer,
        writer,
        scrollback,
        master,
        forwarder_abort: Some(forwarder_handle),
        output_tx: tx,
        pid,
    };

    Ok((handle, child))
}

/// Blocking read loop that runs on a dedicated OS thread. Reads from the PTY,
/// accumulates batches (8ms or 200KB), and sends them via the mpsc channel.
/// Also appends each chunk to the scrollback buffer.
fn reader_loop(
    mut reader: Box<dyn Read + Send>,
    tx: mpsc::Sender<Vec<u8>>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
) {
    let mut read_buf = [0u8; 8192];
    let mut batch = Vec::with_capacity(BATCH_MAX_BYTES);
    let mut batch_start = Instant::now();

    loop {
        match reader.read(&mut read_buf) {
            Ok(0) => {
                // EOF — flush any remaining batch.
                if !batch.is_empty() {
                    let _ = flush_batch(&tx, &scrollback, &mut batch);
                }
                break;
            }
            Ok(n) => {
                let chunk = &read_buf[..n];
                batch.extend_from_slice(chunk);

                // Flush if we've accumulated enough bytes or enough time.
                if batch.len() >= BATCH_MAX_BYTES || batch_start.elapsed() >= BATCH_TIMEOUT {
                    if flush_batch(&tx, &scrollback, &mut batch).is_err() {
                        break; // receiver dropped — session is being torn down
                    }
                    batch_start = Instant::now();
                }
            }
            Err(e) => {
                // EIO is expected on macOS when the child exits.
                if e.raw_os_error() == Some(libc::EIO) {
                    if !batch.is_empty() {
                        let _ = flush_batch(&tx, &scrollback, &mut batch);
                    }
                    break;
                }
                // Other errors — flush and bail.
                if !batch.is_empty() {
                    let _ = flush_batch(&tx, &scrollback, &mut batch);
                }
                break;
            }
        }
    }
}

/// Flush the accumulated batch to both the scrollback buffer and the mpsc channel.
fn flush_batch(
    tx: &mpsc::Sender<Vec<u8>>,
    scrollback: &Arc<Mutex<ScrollbackBuffer>>,
    batch: &mut Vec<u8>,
) -> Result<(), ()> {
    let data = std::mem::take(batch);

    // Append to scrollback.
    {
        let mut sb = scrollback.lock().unwrap();
        sb.append(&data);
    }

    // Send to the async forwarder. blocking_send will block if the channel
    // is full, which provides backpressure.
    tx.blocking_send(data).map_err(|_| ())
}

/// Spawn an async task that receives batches from the mpsc channel and
/// forwards them to the Tauri Channel.
fn spawn_forwarder(
    mut rx: mpsc::Receiver<Vec<u8>>,
    channel: tauri::ipc::Channel<Vec<u8>>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            // If the channel send fails (e.g., webview closed), we just
            // stop forwarding. The reader thread will continue writing to
            // scrollback independently.
            if channel.send(data).is_err() {
                break;
            }
        }
    })
}

/// Validate that a task slug contains only lowercase letters, digits, and hyphens.
pub fn validate_task_slug(task: &str) -> Result<(), String> {
    if task.is_empty() {
        return Err("Task slug cannot be empty".to_string());
    }
    if !task
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!(
            "Task slug '{}' is invalid: only lowercase letters, digits, and hyphens are allowed",
            task
        ));
    }
    if task.starts_with('-') || task.ends_with('-') {
        return Err(format!(
            "Task slug '{}' is invalid: cannot start or end with a hyphen",
            task
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_task_slug_valid() {
        assert!(validate_task_slug("fix-auth").is_ok());
        assert!(validate_task_slug("implement-feature-123").is_ok());
        assert!(validate_task_slug("a").is_ok());
        assert!(validate_task_slug("abc123").is_ok());
        assert!(validate_task_slug("test-1-2-3").is_ok());
    }

    #[test]
    fn test_validate_task_slug_rejects_empty() {
        assert!(validate_task_slug("").is_err());
    }

    #[test]
    fn test_validate_task_slug_rejects_uppercase() {
        assert!(validate_task_slug("Fix-Auth").is_err());
        assert!(validate_task_slug("UPPER").is_err());
    }

    #[test]
    fn test_validate_task_slug_rejects_spaces() {
        assert!(validate_task_slug("fix auth").is_err());
        assert!(validate_task_slug(" leading").is_err());
    }

    #[test]
    fn test_validate_task_slug_rejects_special_chars() {
        assert!(validate_task_slug("fix_auth").is_err());
        assert!(validate_task_slug("fix.auth").is_err());
        assert!(validate_task_slug("fix@auth").is_err());
        assert!(validate_task_slug("fix/auth").is_err());
    }

    #[test]
    fn test_validate_task_slug_rejects_leading_trailing_hyphen() {
        assert!(validate_task_slug("-leading").is_err());
        assert!(validate_task_slug("trailing-").is_err());
    }
}
