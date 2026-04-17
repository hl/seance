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

/// A shared sender that can be swapped atomically. The reader thread holds
/// a reference and checks it on each send, so channel swaps don't kill the
/// reader.
pub struct SwappableSender {
    inner: Mutex<mpsc::Sender<Vec<u8>>>,
}

impl SwappableSender {
    pub fn new(tx: mpsc::Sender<Vec<u8>>) -> Self {
        Self {
            inner: Mutex::new(tx),
        }
    }

    /// Send data using the current sender. Returns Err if the receiver is gone.
    pub fn blocking_send(&self, data: Vec<u8>) -> Result<(), ()> {
        let tx = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        tx.blocking_send(data).map_err(|_| ())
    }

    /// Swap the inner sender for a new one. The old receiver will see the
    /// channel close, but the reader thread keeps running with the new sender.
    pub fn swap(&self, new_tx: mpsc::Sender<Vec<u8>>) {
        let mut tx = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *tx = new_tx;
    }
}

/// Holds the runtime resources for an active PTY session.
pub struct SessionHandle {
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub scrollback: Arc<Mutex<ScrollbackBuffer>>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// The forwarder task join handle — dropping it cancels the task.
    pub forwarder_abort: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Shared sender that the reader thread uses. Can be swapped without
    /// killing the reader.
    pub output_tx: Arc<SwappableSender>,
    pub pid: Option<u32>,
}

impl SessionHandle {
    /// Replace the forwarder task with one that sends to a new Channel.
    /// Returns a snapshot of the scrollback buffer taken atomically with
    /// the forwarder swap, so no output is lost. The reader thread continues
    /// running — it uses the SwappableSender which is updated in place.
    pub fn subscribe(
        &mut self,
        channel: tauri::ipc::Channel<Vec<u8>>,
    ) -> Vec<u8> {
        // Create a new mpsc channel and swap the sender FIRST, so the reader
        // thread always has a live receiver to send into. This prevents a race
        // where aborting the old forwarder drops the old receiver before the
        // new sender is installed, which would cause the reader thread to exit.
        let (new_tx, new_rx) = mpsc::channel::<Vec<u8>>(256);
        self.output_tx.swap(new_tx);

        // Now safe to abort the old forwarder — the reader thread is already
        // using the new sender/receiver pair.
        if let Some(handle) = self.forwarder_abort.take() {
            handle.abort();
        }

        // Snapshot scrollback under its lock.
        let snapshot = {
            let sb = self.scrollback.lock().unwrap_or_else(|e| e.into_inner());
            sb.snapshot()
        };

        // Start a new forwarder task.
        let handle = spawn_forwarder(new_rx, channel);
        self.forwarder_abort = Some(handle);

        snapshot
    }
}

/// Spawn an interactive login shell in a PTY, optionally injecting a command
/// via stdin. Returns a SessionHandle and a child process (moved into the
/// exit watcher).
pub fn spawn_session(
    session_id: Uuid,
    command_line: Option<&str>,
    working_dir: &str,
    hook_port: u16,
    hook_token: &str,
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

    // Spawn an interactive login shell using portable_pty's default prog
    // mechanism: argv[0] is set to "-<shell>" (e.g., "-zsh"), which is the
    // POSIX convention for signalling a login shell.
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(working_dir);

    // Tell the child process it's running in a 256-color terminal.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Set Séance environment variables for the hook system.
    cmd.env("SEANCE_SESSION_ID", session_id.to_string());
    cmd.env("SEANCE_HOOK_PORT", hook_port.to_string());
    cmd.env("SEANCE_HOOK_TOKEN", hook_token);
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
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    // If a command was provided, inject it into the shell's stdin so it
    // runs as if the user typed it. The PTY kernel buffer holds the data
    // until the shell finishes sourcing its init files and starts reading.
    if let Some(cmd) = command_line {
        if !cmd.is_empty() {
            writer
                .write_all(format!("{}\n", cmd).as_bytes())
                .map_err(|e| format!("Failed to write command to PTY stdin: {}", e))?;
        }
    }

    let writer = Arc::new(Mutex::new(writer));
    let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new()));
    let master = Arc::new(Mutex::new(pair.master));

    // mpsc channel for reader thread → forwarder task.
    let (tx, rx) = mpsc::channel::<Vec<u8>>(256);
    let swappable_tx = Arc::new(SwappableSender::new(tx));

    // Start the reader thread (blocking OS thread).
    let reader_tx = swappable_tx.clone();
    let reader_scrollback = scrollback.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader-{}", &session_id.to_string()[..8]))
        .spawn(move || {
            reader_loop(reader, reader_tx, reader_scrollback);
        })
        .map_err(|e| format!("Failed to spawn reader thread: {}", e))?;

    // Start a drain task that keeps the mpsc receiver alive (prevents
    // reader thread from failing on send) but drops data until
    // subscribe_output attaches a real Channel.
    let drain_handle = tauri::async_runtime::spawn(async move {
        let mut rx = rx;
        while rx.recv().await.is_some() {
            // Drain — data is in scrollback already
        }
    });

    let killer = child.clone_killer();

    let handle = SessionHandle {
        killer,
        writer,
        scrollback,
        master,
        forwarder_abort: Some(drain_handle),
        output_tx: swappable_tx,
        pid,
    };

    Ok((handle, child))
}

/// Blocking read loop that runs on a dedicated OS thread. Reads from the PTY,
/// accumulates batches (8ms or 200KB), and sends them via the mpsc channel.
/// Also appends each chunk to the scrollback buffer.
fn reader_loop(
    mut reader: Box<dyn Read + Send>,
    tx: Arc<SwappableSender>,
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
                // EIO (5) is expected on macOS/Linux when the child exits.
                if e.raw_os_error() == Some(5) {
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
    tx: &Arc<SwappableSender>,
    scrollback: &Arc<Mutex<ScrollbackBuffer>>,
    batch: &mut Vec<u8>,
) -> Result<(), ()> {
    let data = std::mem::take(batch);

    // Append to scrollback (recover from poison rather than crashing).
    {
        let mut sb = scrollback.lock().unwrap_or_else(|e| e.into_inner());
        sb.append(&data);
    }

    // Send to the async forwarder via the swappable sender. If the receiver
    // was swapped, this will use the new channel automatically.
    tx.blocking_send(data)
}

/// Spawn an async task that receives batches from the mpsc channel and
/// forwards them to the Tauri Channel.
fn spawn_forwarder(
    mut rx: mpsc::Receiver<Vec<u8>>,
    channel: tauri::ipc::Channel<Vec<u8>>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            // If the channel send fails (e.g., webview closed), fall back
            // to draining. We must keep the receiver alive so the reader
            // thread's blocking_send doesn't fail — the reader also writes
            // to scrollback, which must continue even without a UI.
            if channel.send(data).is_err() {
                // Drain until the receiver is swapped out by a new subscribe()
                // or the session exits (sender dropped).
                while rx.recv().await.is_some() {}
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
