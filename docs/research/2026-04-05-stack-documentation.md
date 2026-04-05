# Stack Documentation Research

Date: 2026-04-05
Purpose: API reference and best practices for Seance v1 technology stack

---

## 1. Tauri v2 (latest stable: 2.10.x)

### 1.1 Multi-Window Management

**Creating windows from Rust (commands or setup hook):**

```rust
use tauri::{AppHandle, WebviewWindowBuilder, WebviewUrl};

// From a command
#[tauri::command]
fn open_project_window(app: AppHandle, project_id: String) -> tauri::Result<()> {
    let label = format!("project-{}", project_id);
    match app.webview_windows().get(&label) {
        Some(window) => {
            window.set_focus()?;
        }
        None => {
            WebviewWindowBuilder::new(
                &app,
                &label,
                WebviewUrl::App("index.html".into()),
            )
            .title("Seance")
            .inner_size(1200.0, 800.0)
            .center(true)
            .build()?;
        }
    }
    Ok(())
}

// From setup hook
tauri::Builder::default()
    .setup(|app| {
        let _main_window = WebviewWindowBuilder::new(
            app,
            "main",
            WebviewUrl::App("index.html".into()),
        )
        .title("Seance")
        .build()?;
        Ok(())
    })
```

**Window labels** must be unique per window. Alphanumeric plus `-`, `/`, `:`, `_`. Cannot create two windows with the same label -- check `app.webview_windows().get(&label)` first.

**Key builder methods:**
- `.title(str)` -- window title
- `.inner_size(width, height)` -- dimensions in logical pixels (f64)
- `.center(true)` -- center on screen
- `.position(x, y)` -- explicit position
- `.resizable(bool)`, `.decorations(bool)`, `.closable(bool)`
- `.always_on_top(bool)`, `.focused(bool)`, `.visible(bool)`
- `.transparent(bool)` -- requires `macOSPrivateApi: true` in tauri.conf.json
- `.theme(Some(tauri::Theme::Dark))`

**Accessing existing windows:**
```rust
use tauri::Manager;
// All windows
let windows = app.webview_windows(); // HashMap<String, WebviewWindow>
// Specific window
let window = app.get_webview_window("main").unwrap();
```

**From JavaScript:**
```typescript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const webview = new WebviewWindow('project-123', {
    url: 'index.html',
    title: 'Project View',
    width: 1200,
    height: 800,
    center: true,
});

webview.once('tauri://created', () => { /* success */ });
webview.once('tauri://error', (e) => { /* creation failed */ });
```

**Static access from JS:**
```typescript
import { Window } from '@tauri-apps/api/window';
Window.getAll()         // all windows
Window.getCurrent()     // current window
Window.getByLabel(l)    // specific window
Window.getFocusedWindow()
```

### 1.2 Window Lifecycle Events

**From Rust -- per-window events via on_window_event:**
```rust
tauri::Builder::default()
    .on_window_event(|window, event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Prevent the close, hide instead
                api.prevent_close();
                window.hide().unwrap();
            }
            tauri::WindowEvent::Destroyed => {
                // Window was destroyed -- cleanup
            }
            tauri::WindowEvent::Focused(is_focused) => {
                // Window gained/lost focus
            }
            tauri::WindowEvent::Resized(size) => {
                // PhysicalSize { width, height }
            }
            tauri::WindowEvent::Moved(position) => {
                // PhysicalPosition { x, y }
            }
            tauri::WindowEvent::ThemeChanged(theme) => {
                // tauri::Theme::Light or Dark
            }
            _ => {}
        }
    })
```

**WindowEvent variants** (Tauri v2): `CloseRequested { api }`, `Destroyed`, `Focused(bool)`, `Resized(PhysicalSize)`, `Moved(PhysicalPosition)`, `ScaleFactorChanged`, `DragDrop(DragDropEvent)`, `ThemeChanged(Theme)`.

**From JavaScript:**
```typescript
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
const appWebview = getCurrentWebviewWindow();

appWebview.onCloseRequested(async (event) => {
    // event.preventDefault() to cancel
});
appWebview.onFocusChanged(({ payload: focused }) => { });
appWebview.onResized(({ payload: size }) => { });
```

### 1.3 Events vs Channels for IPC

**Events** -- fire-and-forget notifications, not type-safe (JSON), no return values:
```rust
use tauri::{AppHandle, Emitter};

// Global broadcast
app.emit("status-changed", payload)?;

// Target specific window
app.emit_to("project-123", "status-changed", payload)?;

// Filter to multiple targets
use tauri::EventTarget;
app.emit_filter("event", payload, |target| match target {
    EventTarget::WebviewWindow { label } => label.starts_with("project-"),
    _ => false,
})?;
```

**JS listener:**
```typescript
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen<StatusPayload>('status-changed', (event) => {
    console.log(event.payload);
});
// Cleanup
unlisten();
```

**Channels** -- ordered, high-throughput streaming from Rust to frontend. Recommended for streaming data like PTY output:

```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum PtyEvent {
    Output { data: Vec<u8> },
    Exit { code: Option<i32> },
}

#[tauri::command]
fn subscribe_pty(session_id: String, on_event: Channel<PtyEvent>) {
    // Store the channel, send data from PTY reader thread:
    on_event.send(PtyEvent::Output { data: bytes }).unwrap();
}
```

**JS side -- Channel constructor:**
```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

type PtyEvent =
    | { event: 'output'; data: { data: number[] } }
    | { event: 'exit'; data: { code: number | null } };

const onEvent = new Channel<PtyEvent>();
onEvent.onmessage = (message) => {
    if (message.event === 'output') {
        terminal.write(new Uint8Array(message.data.data));
    }
};
await invoke('subscribe_pty', { sessionId: id, onEvent });
```

**When to use which:**
| Mechanism | Type Safety | Direction | Return | Use Case |
|-----------|------------|-----------|--------|----------|
| Commands  | Yes        | JS->Rust  | Yes    | Request/response |
| Events    | No (JSON)  | Both      | No     | Broadcasts, status updates |
| Channels  | Yes        | Rust->JS  | Stream | PTY output, high-throughput |

**Critical for Seance:** Use Channels for PTY output streaming (R7, R9). Use Events for status update broadcasts across windows (R11-R14). Events work well because status updates are small JSON payloads broadcast to all windows showing the same project.

### 1.4 State Management

```rust
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    sessions: HashMap<String, Session>,
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![...])
        .run(tauri::generate_context!())
        .expect("error");
}

// In commands -- use State extractor
#[tauri::command]
fn get_sessions(state: tauri::State<'_, Mutex<AppState>>) -> Vec<SessionInfo> {
    let state = state.lock().unwrap();
    // ...
}

// In async commands -- use tokio::sync::Mutex
#[tauri::command]
async fn async_cmd(state: tauri::State<'_, tokio::sync::Mutex<AppState>>) -> Result<(), String> {
    let mut state = state.lock().await;
    // Can hold across .await points
    Ok(())
}

// Outside commands -- use AppHandle
fn background_task(app_handle: AppHandle) {
    let state = app_handle.state::<Mutex<AppState>>();
    let mut state = state.lock().unwrap();
    // ...
}
```

**Key facts:**
- Tauri wraps managed state in `Arc` automatically. No need for explicit `Arc<T>`.
- Wrong type in `State<T>` causes a **runtime panic**, not a compile error.
- For state shared between sync commands and background threads: `std::sync::Mutex`
- For state shared with async code that holds locks across `.await`: `tokio::sync::Mutex`
- Access via `AppHandle::state::<T>()` from setup hooks, event handlers, or spawned tasks.

### 1.5 macOS: Keep App Alive, Dock Icon Click, App Lifecycle

**RunEvent enum** (key variants):
- `Ready` -- event loop ready
- `Resumed` -- app resumed
- `ExitRequested { api, code }` -- app about to exit
- `Exit` -- app is exiting (cleanup here)
- `Reopen` -- macOS dock icon clicked (added in Tauri 2.0)
- `WindowEvent { label, event }` -- window-specific event
- `WebviewEvent { label, event }` -- webview-specific event
- `MainEventsCleared`

**Pattern for macOS dock behavior (R44):**
```rust
tauri::Builder::default()
    .setup(|app| {
        // ...
        Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error building app")
    .run(|app_handle, event| {
        match event {
            // Prevent quit when all windows closed
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() {
                    // code is None when triggered by last window closing
                    // code is Some(n) when triggered by app.exit(n)
                    api.prevent_exit();
                }
            }

            // macOS dock icon click -- reopen picker window
            tauri::RunEvent::Reopen { .. } => {
                let windows = app_handle.webview_windows();
                if windows.is_empty() {
                    // Create picker window
                    WebviewWindowBuilder::new(
                        app_handle,
                        "picker",
                        WebviewUrl::App("index.html".into()),
                    )
                    .title("Seance")
                    .build()
                    .unwrap();
                } else {
                    // Focus the first available window
                    if let Some((_label, window)) = windows.iter().next() {
                        window.set_focus().unwrap();
                    }
                }
            }

            // Cleanup on actual exit (Cmd+Q)
            tauri::RunEvent::Exit => {
                // Kill all PTY processes, stop axum server
            }

            _ => {}
        }
    });
```

**IMPORTANT:** Must use `.build().expect().run()` pattern instead of `.run().expect()` to get access to `RunEvent` in the closure.

**Known limitation (Issue #13511):** The `ExitRequested { code }` approach to distinguish window-close from manual-exit is a workaround. When `code.is_none()`, the exit was triggered by the last window closing. When `code.is_some()`, it was a programmatic `app.exit()` call. This works but is not yet a first-class API.

### 1.6 Setup Hook for Background Tasks

```rust
tauri::Builder::default()
    .setup(|app| {
        let app_handle = app.handle().clone();

        // Spawn axum server
        tauri::async_runtime::spawn(async move {
            start_hook_server(app_handle).await;
        });

        // Spawn PTY reader on dedicated thread (blocking I/O)
        // (done per-session, not in setup)

        Ok(())
    })
```

**Key patterns:**
- Setup hook is **synchronous** -- event loop does not run until setup returns.
- Use `tauri::async_runtime::spawn()` for async tasks (runs on Tauri's tokio runtime).
- Use `std::thread::spawn()` for blocking I/O tasks (PTY readers).
- Clone `app.handle()` and move it into spawned tasks.
- The AppHandle provides access to managed state, event emission, and window management.

### 1.7 Global Keyboard Shortcuts (Cmd+1-9)

**Plugin:** `tauri-plugin-global-shortcut`

**Installation:**
```bash
npm run tauri add global-shortcut
# Installs both Cargo crate and JS bindings
```

**Rust registration in setup:**
```rust
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(desktop)]
{
    let shortcuts: Vec<Shortcut> = (1..=9)
        .map(|n| {
            let code = match n {
                1 => Code::Digit1, 2 => Code::Digit2, 3 => Code::Digit3,
                4 => Code::Digit4, 5 => Code::Digit5, 6 => Code::Digit6,
                7 => Code::Digit7, 8 => Code::Digit8, 9 => Code::Digit9,
                _ => unreachable!(),
            };
            Shortcut::new(Some(Modifiers::SUPER), code) // SUPER = Cmd on macOS
        })
        .collect();

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    // Determine which digit was pressed
                    // Emit event to focused window
                    app.emit("switch-session", digit).unwrap();
                }
            })
            .build(),
    )?;

    for shortcut in &shortcuts {
        app.global_shortcut().register(*shortcut)?;
    }
}
```

**Permissions** (src-tauri/capabilities/default.json):
```json
{
    "permissions": [
        "global-shortcut:allow-register",
        "global-shortcut:allow-unregister",
        "global-shortcut:allow-is-registered"
    ]
}
```

**Known issue:** Global shortcuts with `CommandOrControl` can fire twice on macOS (Issue #10025). Use `Modifiers::SUPER` for macOS-only. Consider registering shortcuts only when the app is focused to avoid conflicts with other apps.

**Alternative approach for Seance:** Since Cmd+1-9 is an in-app shortcut (R36 says "handled at Tauri level, above xterm.js key capture"), consider using `attachCustomKeyEventHandler` on the xterm.js side to intercept Cmd+digit before xterm.js processes it. This avoids global shortcut conflicts and only works when the app is focused -- which is the desired behavior.

### 1.8 File Dialog for Directory Selection

**Plugin:** `tauri-plugin-dialog`

**Installation:**
```bash
npm run tauri add dialog
```

**JavaScript usage (R19 -- project directory picker):**
```typescript
import { open } from '@tauri-apps/plugin-dialog';

const selectedDir = await open({
    directory: true,
    multiple: false,
    title: 'Select Project Directory',
});
// Returns string path on desktop, null if cancelled
```

**Rust usage:**
```rust
use tauri_plugin_dialog::DialogExt;

let path = app.dialog().file()
    .set_title("Select Project Directory")
    .blocking_pick_folder(); // Returns Option<PathBuf>
```

**Permissions** (default set includes `allow-open`).

---

## 2. portable-pty (v0.9.0, released Feb 2025)

### 2.1 Overview

Cross-platform PTY interface from the wezterm project. Trait-based design with runtime-selectable implementations. Blocking I/O only -- no native async support.

### 2.2 Core API

**Opening a PTY:**
```rust
use portable_pty::{native_pty_system, PtySize, CommandBuilder, PtySystem};

let pty_system = native_pty_system();
let pair = pty_system.openpty(PtySize {
    rows: 24,
    cols: 80,
    pixel_width: 0,
    pixel_height: 0,
})?;
// pair.master: Box<dyn MasterPty>
// pair.slave: Box<dyn SlavePty>
```

**Spawning a command with environment variables (R1, R17):**
```rust
let mut cmd = CommandBuilder::new("bash");
cmd.args(&["-c", &resolved_command_template]);
cmd.cwd(&project_dir);

// Inject Seance environment variables
cmd.env("SEANCE_SESSION_ID", &session_id);
cmd.env("SEANCE_HOOK_PORT", &port.to_string());
cmd.env("SEANCE_HOOK_URL", &format!("http://localhost:{}/session/{}/status", port, session_id));
cmd.env("TERM", "xterm-256color");

let child = pair.slave.spawn_command(cmd)?;
// child: Box<dyn Child>
// Drop slave after spawning -- only master is needed
drop(pair.slave);
```

**CommandBuilder methods:**
- `new(program)` / `new_default_prog()` -- create builder
- `arg(s)` / `args(iter)` -- append arguments
- `env(key, value)` -- set environment variable
- `env_remove(key)` -- remove variable
- `env_clear()` -- clear all overrides
- `cwd(dir)` -- set working directory
- `get_argv()` / `get_env(key)` / `get_cwd()`

### 2.3 Reading PTY Output (Blocking)

```rust
// Clone reader -- can be called multiple times for multiple readers
let mut reader = pair.master.try_clone_reader()?;
// Returns Box<dyn Read + Send>

// Dedicated thread for reading (BLOCKING -- must not run on tokio runtime)
std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF -- process exited
            Ok(n) => {
                let data = buf[..n].to_vec();
                // Send data to frontend via channel or to scrollback buffer
            }
            Err(e) => {
                // Handle error (e.g., EAGAIN, broken pipe)
                break;
            }
        }
    }
});
```

**Critical for Seance (Outstanding Question from requirements):** `try_clone_reader()` returns a blocking `Read` impl. Must run on a dedicated `std::thread`, NOT on tokio's async runtime (would block the executor). Use `tokio::sync::mpsc` channels to bridge between the blocking reader thread and async Tauri commands/events.

### 2.4 Writing Input to PTY

```rust
// take_writer() can only be called ONCE -- returns Box<dyn Write + Send>
let mut writer = pair.master.take_writer()?;

// Write user input from frontend
writer.write_all(input_bytes)?;
// Dropping writer sends EOF to the PTY
```

**Important:** `take_writer()` can only be called once. Store the writer and share it (e.g., via `Arc<Mutex<Box<dyn Write + Send>>>`). Dropping the writer sends EOF, which will terminate the child process's stdin.

### 2.5 Resizing PTY (R8)

```rust
use portable_pty::PtySize;

pair.master.resize(PtySize {
    rows: new_rows,
    cols: new_cols,
    pixel_width: 0,
    pixel_height: 0,
})?;
// Sends SIGWINCH to the child process
```

### 2.6 Killing Child Processes (R6)

```rust
// Child trait methods:
child.kill()?;              // Send SIGKILL
let status = child.wait()?; // BLOCKING -- wait for exit
// ExitStatus provides .success() and code

// ChildKiller trait -- cloneable handle for termination
let killer = child.clone_killer();
// Can be stored separately and called from another thread
killer.kill()?;
```

**For Seance R6 (kill action):** Store a `Box<dyn ChildKiller>` per session. Call `killer.kill()` from the Tauri command. The reader thread will see EOF and clean up. `child.wait()` is blocking -- run on `std::thread::spawn` or `tokio::task::spawn_blocking`.

### 2.7 MasterPty Trait (complete)

```rust
trait MasterPty {
    fn resize(&self, size: PtySize) -> Result<(), Error>;
    fn get_size(&self) -> Result<PtySize, Error>;
    fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>, Error>;
    fn take_writer(&self) -> Result<Box<dyn Write + Send>, Error>;
    fn process_group_leader(&self) -> Option<pid_t>;
    fn as_raw_fd(&self) -> Option<RawFd>;
    fn tty_name(&self) -> Option<PathBuf>;
    fn get_termios(&self) -> Option<Termios>;  // provided
}
```

### 2.8 Known Limitations

- No async support -- all I/O is blocking.
- `take_writer()` is single-call only.
- No built-in output buffering or backpressure.
- On macOS, `process_group_leader()` may return the group leader PID which can be used for cleanup (R-PTY-cleanup).

---

## 3. axum (v0.8.x, released Jan 2025)

### 3.1 Breaking Changes from 0.7

1. **Path parameter syntax changed:** `:param` -> `{param}`, `*wildcard` -> `{*wildcard}`
   ```rust
   // Old (0.7): .route("/session/:session_id/status", post(handler))
   // New (0.8): .route("/session/{session_id}/status", post(handler))
   ```

2. **`#[async_trait]` removed:** Native Rust async trait support used instead. Remove `#[async_trait]` from custom extractor impls.

3. **`Option<T>` extractor stricter:** Must impl `OptionalFromRequestParts`.

### 3.2 Single-Endpoint POST Handler (R15)

```rust
use axum::{Router, routing::post, extract::{Path, State, Json}, response::IntoResponse};
use std::sync::Arc;

#[derive(Clone)]
struct HookState {
    app_handle: tauri::AppHandle,
    // or shared session state
}

#[derive(serde::Deserialize)]
struct StatusUpdate {
    status: String,   // "thinking" | "waiting" | "done" | "error"
    message: Option<String>,
}

async fn update_status(
    Path(session_id): Path<String>,
    State(state): State<Arc<HookState>>,
    Json(body): Json<StatusUpdate>,
) -> impl IntoResponse {
    // Update session status via shared state
    // Emit event to frontend
    state.app_handle.emit("session-status", StatusPayload {
        session_id,
        status: body.status,
        message: body.message,
    }).unwrap();

    axum::http::StatusCode::OK
}

let app = Router::new()
    .route("/session/{session_id}/status", post(update_status))
    .with_state(Arc::new(HookState { app_handle }));
```

### 3.3 Running Alongside Tauri's Tokio Runtime

**Recommended approach:** Spawn axum on Tauri's own tokio runtime using `tauri::async_runtime::spawn()`. This shares the runtime and allows direct access to `AppHandle`.

```rust
// In Tauri setup hook:
let app_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    let hook_state = Arc::new(HookState { app_handle });
    let router = Router::new()
        .route("/session/{session_id}/status", post(update_status))
        .with_state(hook_state);

    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, router).await.unwrap();
});
```

**Port conflict detection (R16):**
```rust
match tokio::net::TcpListener::bind(&addr).await {
    Ok(listener) => {
        axum::serve(listener, router).await.unwrap();
    }
    Err(e) => {
        // Port in use -- emit error to frontend
        app_handle.emit("hook-server-error", format!("Port {} in use: {}", port, e)).unwrap();
    }
}
```

**State sharing pattern:** The `Arc<HookState>` containing the `AppHandle` gives the axum handler full access to Tauri's managed state via `app_handle.state::<T>()` and event emission via `app_handle.emit()`.

**Alternative (separate runtime):** If isolation is preferred:
```rust
std::thread::spawn(move || {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async move {
        // axum server here
    });
});
```
This requires channel bridges (`tokio::sync::mpsc`) to communicate with Tauri's runtime. More complex, less recommended for Seance since we need AppHandle access anyway.

---

## 4. @xterm/xterm v6 (released Dec 2024)

### 4.1 Migration from v4/v5 to v6

**Package renames (scoped packages):**
| Old Package | New Package |
|-------------|-------------|
| `xterm` | `@xterm/xterm` |
| `xterm-addon-webgl` | `@xterm/addon-webgl` |
| `xterm-addon-fit` | `@xterm/addon-fit` |
| `xterm-addon-search` | `@xterm/addon-search` |
| `xterm-addon-serialize` | `@xterm/addon-serialize` |
| `xterm-addon-web-links` | `@xterm/addon-web-links` |

Old unscoped packages are deprecated and will not receive updates.

**Breaking changes in v6.0.0:**
- **Canvas renderer removed.** Only DOM renderer (default) and WebGL renderer remain. Use `@xterm/addon-webgl` for performance.
- **`windowsMode` option removed.**
- **`fastScrollModifier` option removed.**
- **`overviewRulerWidth` restructured** -- now under `ITerminalOptions.overviewRuler`.
- **EventEmitter replaced** with VS Code's internal Emitter.
- **Scroll bar redesign** -- viewport/scroll bar implementation changed significantly.
- **Bundle size reduced ~30%** (379KB -> 265KB).

**New features in v6:**
- Synchronized output support (DEC mode 2026)
- `onWriteParsed` event -- fires after data has been parsed
- Shadow DOM support in WebGL renderer
- `reflowCursorLine` option
- ESM support via esbuild
- ANSI OSC52 support

### 4.2 Terminal Setup for Seance

```typescript
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const terminal = new Terminal({
    // ITerminalOptions
    cursorBlink: true,
    fontSize: 14,           // from global settings
    fontFamily: 'Menlo, monospace',
    scrollback: 10000,      // R10: bounded scrollback
    allowProposedApi: true,  // for experimental features
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

// Open terminal in DOM
terminal.open(containerElement);

// Load WebGL renderer for performance
try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        // Falls back to DOM renderer automatically
    });
    terminal.loadAddon(webglAddon);
} catch (e) {
    console.warn('WebGL not available, using DOM renderer');
}

// Fit to container
fitAddon.fit();
```

### 4.3 Writing Data (PTY Output -> Terminal)

```typescript
// String data (UTF-16)
terminal.write('Hello, world!\r\n');

// Binary data (UTF-8 bytes from PTY) -- PREFERRED for raw PTY output
terminal.write(new Uint8Array(data));

// With completion callback
terminal.write(data, () => {
    // Data has been written to the internal buffer
});

// writeln -- appends \r\n
terminal.writeln('Line with newline');
```

**write() is streaming-aware:** Input decoders compose codepoints from consecutive multibyte chunks. Safe to split UTF-8 across multiple write() calls.

**For scrollback replay (R9):** Write the entire scrollback buffer in one call using `terminal.write(new Uint8Array(scrollbackBytes))`. The callback can be used to scroll to bottom after replay.

### 4.4 Handling User Input

```typescript
// onData -- real string data, UTF-16 encoded
// This is what you send to the PTY
terminal.onData((data: string) => {
    // Send to Rust backend -> PTY writer
    invoke('write_to_pty', { sessionId, data });
});

// onKey -- keyboard events with DOM event
terminal.onKey(({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) => {
    // Can inspect domEvent.metaKey, domEvent.key, etc.
});

// onBinary -- raw binary data (legacy mouse reports only)
// Rarely needed
terminal.onBinary((data: string) => {
    // Each char maps to a byte value (0-255)
});
```

**Intercepting keys before xterm.js processes them (R36: Cmd+1-9):**
```typescript
terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.metaKey && event.key >= '1' && event.key <= '9') {
        // Handle session switching
        const index = parseInt(event.key) - 1;
        switchToSession(index);
        return false; // Prevent xterm.js from processing
    }
    return true; // Let xterm.js handle normally
});
```

### 4.5 Resizing (R8)

```typescript
// Fit addon -- matches terminal size to container
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

// Call on window resize
window.addEventListener('resize', () => {
    fitAddon.fit();
});

// Also use ResizeObserver for container changes
const observer = new ResizeObserver(() => {
    fitAddon.fit();
});
observer.observe(containerElement);

// Listen for terminal resize to sync with PTY
terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    // Send new dimensions to Rust -> PTY master.resize()
    invoke('resize_pty', { sessionId, cols, rows });
});

// Manual resize
terminal.resize(columns, rows);
```

### 4.6 Terminal Lifecycle

```typescript
// Clear visible area (keeps scrollback)
terminal.clear();

// Full reset (clears everything)
terminal.reset();

// Dispose (cleanup)
terminal.dispose();

// Scroll control
terminal.scrollToBottom();
terminal.scrollToTop();
terminal.scrollLines(n); // positive = down, negative = up
```

### 4.7 Official Addon Packages (v6)

| Package | Purpose |
|---------|---------|
| `@xterm/addon-webgl` | WebGL2 renderer (recommended for performance) |
| `@xterm/addon-fit` | Auto-size terminal to container |
| `@xterm/addon-search` | Text search in buffer |
| `@xterm/addon-serialize` | Serialize buffer to VT sequences or HTML |
| `@xterm/addon-web-links` | Clickable URL detection |
| `@xterm/addon-image` | Image rendering (sixel, iTerm2) |
| `@xterm/addon-clipboard` | Browser clipboard access |
| `@xterm/addon-ligatures` | Font ligature support |
| `@xterm/addon-unicode-graphemes` | Grapheme clustering |
| `@xterm/addon-web-fonts` | Web font loading |
| `@xterm/addon-progress` | Progress API |

**For Seance:** Core addons needed are `@xterm/addon-webgl`, `@xterm/addon-fit`, and optionally `@xterm/addon-web-links`.

### 4.8 Validation Needed (from requirements doc)

> v6 removed canvas renderer, only DOM and WebGL remain

**Confirmed.** The canvas renderer addon no longer exists in v6. WebGL is the recommended renderer for performance. Falls back to DOM if WebGL context is unavailable or lost.

**Scrollback replay performance:** Writing large scrollback buffers (potentially megabytes) in a single `terminal.write()` call should work but may cause a visible pause. Consider:
1. Using the `onWriteParsed` event (new in v6) to detect when parsing completes
2. Batching the write in chunks with small delays if needed
3. The WebGL renderer handles large writes better than DOM

---

## 5. Zustand v5 (v5.0.10, Jan 2026) with React 19

### 5.1 Breaking Changes from v4

1. **Default exports removed.** Must use named imports:
   ```typescript
   // v4 (deprecated)
   import create from 'zustand';
   // v5
   import { create } from 'zustand';
   ```

2. **Custom equality function removed from `create()`.**
   For shallow comparison, use `createWithEqualityFn` from `zustand/traditional`:
   ```typescript
   import { createWithEqualityFn as create } from 'zustand/traditional';
   import { shallow } from 'zustand/shallow';
   const useStore = create(storeCreator, shallow);
   ```
   Or use the `useShallow` hook (preferred in v5):
   ```typescript
   import { useShallow } from 'zustand/react/shallow';
   const { a, b } = useStore(useShallow((s) => ({ a: s.a, b: s.b })));
   ```

3. **`use-sync-external-store` is a peer dependency** (required for `zustand/traditional`).
   ```bash
   npm install use-sync-external-store
   ```

4. **React 18 minimum required.** React 19 is fully supported.

5. **TypeScript 4.5 minimum.** Improved type inference.

6. **`setState` with `replace: true` requires complete state object.**

7. **`persist` middleware no longer stores initial state on creation.** Only stores after first `setState`.

8. **ES5 and UMD/SystemJS support dropped.**

9. **Middleware imports reorganized:**
   ```typescript
   // v5 middleware
   import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
   import { immer } from 'zustand/middleware/immer';
   ```

### 5.2 Store Creation for Seance

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Types
interface Session {
    id: string;
    projectId: string;
    name: string;         // generated two-word name
    task: string;         // user-assigned task label
    status: 'running' | 'thinking' | 'waiting' | 'done' | 'error' | 'exited';
    statusMessage: string | null;
    createdAt: number;
}

interface Project {
    id: string;
    name: string;
    path: string;
    commandTemplate: string;
}

// Session store (not persisted -- sessions reset on restart per R29)
interface SessionStore {
    sessions: Record<string, Session>;
    activeSessionId: string | null;

    setActiveSession: (id: string) => void;
    updateSessionStatus: (id: string, status: string, message?: string) => void;
    addSession: (session: Session) => void;
    removeSession: (id: string) => void;
}

const useSessionStore = create<SessionStore>()((set) => ({
    sessions: {},
    activeSessionId: null,

    setActiveSession: (id) => set({ activeSessionId: id }),

    updateSessionStatus: (id, status, message) =>
        set((state) => ({
            sessions: {
                ...state.sessions,
                [id]: {
                    ...state.sessions[id],
                    status: status as Session['status'],
                    statusMessage: message ?? state.sessions[id]?.statusMessage ?? null,
                },
            },
        })),

    addSession: (session) =>
        set((state) => ({
            sessions: { ...state.sessions, [session.id]: session },
        })),

    removeSession: (id) =>
        set((state) => {
            const { [id]: _, ...rest } = state.sessions;
            return { sessions: rest };
        }),
}));

// Project store (persisted per R28)
interface ProjectStore {
    projects: Record<string, Project>;
    addProject: (project: Project) => void;
    updateProject: (id: string, updates: Partial<Project>) => void;
    removeProject: (id: string) => void;
}

const useProjectStore = create<ProjectStore>()(
    persist(
        (set) => ({
            projects: {},
            addProject: (project) =>
                set((state) => ({
                    projects: { ...state.projects, [project.id]: project },
                })),
            updateProject: (id, updates) =>
                set((state) => ({
                    projects: {
                        ...state.projects,
                        [id]: { ...state.projects[id], ...updates },
                    },
                })),
            removeProject: (id) =>
                set((state) => {
                    const { [id]: _, ...rest } = state.projects;
                    return { projects: rest };
                }),
        }),
        {
            name: 'seance-projects',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
```

### 5.3 Selectors and Performance

```typescript
// Single value selector -- only re-renders when this value changes
const status = useSessionStore((s) => s.sessions[sessionId]?.status);

// Multiple values with useShallow -- prevents object reference re-renders
import { useShallow } from 'zustand/react/shallow';

const { sessions, activeSessionId } = useSessionStore(
    useShallow((s) => ({
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
    }))
);

// Computed selector
const sessionList = useSessionStore((s) =>
    Object.values(s.sessions)
        .filter((session) => session.projectId === projectId)
        .sort((a, b) => a.createdAt - b.createdAt)
);
// WARNING: this creates a new array reference every time.
// Wrap in useMemo or use useShallow for the filter result.
```

### 5.4 Subscribing to Store Changes Outside React

```typescript
// For listening to Tauri events and updating store
import { listen } from '@tauri-apps/api/event';

// Direct store access (no hook needed)
const { updateSessionStatus } = useSessionStore.getState();

listen<StatusPayload>('session-status', (event) => {
    const { sessionId, status, message } = event.payload;
    updateSessionStatus(sessionId, status, message);
});
```

### 5.5 Slice Pattern for Larger Stores

```typescript
import { create, StateCreator } from 'zustand';

interface AuthSlice { /* ... */ }
interface SessionSlice { /* ... */ }

const createSessionSlice: StateCreator<
    SessionSlice & AuthSlice, [], [], SessionSlice
> = (set, get) => ({ /* ... */ });

const useBoundStore = create<SessionSlice & AuthSlice>()((...a) => ({
    ...createSessionSlice(...a),
    ...createAuthSlice(...a),
}));
```

### 5.6 React 19 Compatibility

Zustand v5 uses `useSyncExternalStore` internally, which is fully compatible with React 19's concurrent features. No additional configuration needed. Async actions work natively:

```typescript
const useStore = create((set) => ({
    loading: false,
    data: null,
    fetchData: async () => {
        set({ loading: true });
        const data = await fetch('/api/data').then(r => r.json());
        set({ data, loading: false });
    },
}));
```

---

## 6. Architecture Recommendations (Answers to Outstanding Questions)

### PTY-to-Frontend Data Path

**Recommended:** Dedicated `std::thread` per session for PTY reads -> `tokio::sync::mpsc` channel -> Tauri Channel (IPC) to frontend.

```
[PTY Reader Thread] --bytes--> [mpsc::Sender] --bytes--> [async bridge task] --Channel<PtyEvent>--> [Frontend]
                                                              |
                                                    [Scrollback Buffer]
                                                    (append bytes here)
```

Rationale: portable-pty's blocking reads cannot run on tokio. The bridge task runs on Tauri's async runtime and can both append to the scrollback buffer and forward to the frontend via Channel.

### Scrollback Buffer Representation

**Recommended:** Raw bytes. Replay by writing the entire buffer to xterm.js via `terminal.write(new Uint8Array(buffer))`. Simpler than parsed terminal state snapshots. Use a byte-cap (e.g., 5MB) in addition to the 10K line target to handle pathological output.

### axum/Tauri Runtime Coexistence

**Recommended:** Shared runtime via `tauri::async_runtime::spawn()`. The axum handler gets an `AppHandle` through its State, giving it direct access to Tauri's managed state and event emission. No channel bridge needed.

### Multi-Window Lifecycle

- `WindowEvent::CloseRequested` with hidden label check to decide hide vs close.
- `RunEvent::ExitRequested { code: None }` with `api.prevent_exit()` for last-window-closed.
- `RunEvent::Reopen` for dock icon click -- create picker window.
- Events with `emit_to(label, ...)` or `emit_filter(...)` for targeting specific project windows.
- Window labels like `project-{project_id}` enable routing.

### Cmd+1-9 Shortcuts

**Recommended:** Use `terminal.attachCustomKeyEventHandler()` on the xterm.js side rather than the global-shortcut plugin. This avoids system-wide conflicts and is simpler. The handler intercepts Cmd+digit before xterm.js processes it and dispatches session switching within the React component tree.

---

## Sources

### Tauri v2
- [Window API Reference](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [Calling Rust (Commands, Events, Channels)](https://v2.tauri.app/develop/calling-rust/)
- [Calling Frontend (Events, Channels)](https://v2.tauri.app/develop/calling-frontend/)
- [State Management](https://v2.tauri.app/develop/state-management/)
- [Global Shortcut Plugin](https://v2.tauri.app/plugin/global-shortcut/)
- [Dialog Plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri 2.0 Release Blog](https://v2.tauri.app/blog/tauri-20/)
- [Prevent Exit Issue #13511](https://github.com/tauri-apps/tauri/issues/13511)
- [System Tray App Discussion #11489](https://github.com/tauri-apps/tauri/discussions/11489)
- [Cleanup Before Exit Discussion #10531](https://github.com/tauri-apps/tauri/discussions/10531)
- [Dock Icon Click Discussion #6600](https://github.com/tauri-apps/tauri/discussions/6600)
- [Creating Windows Tutorial](https://tauritutorials.com/blog/creating-windows-in-tauri)
- [Async Rust Process Pattern](https://rfdonnelly.github.io/posts/tauri-async-rust-process/)
- [Long-Running Tasks in Tauri v2](https://sneakycrow.dev/blog/2024-05-12-running-async-tasks-in-tauri-v2)
- [App and AppHandle Lifecycle](https://deepwiki.com/tauri-apps/tauri/2.2-app-and-apphandle)
- [Global Shortcut Double-Fire Issue #10025](https://github.com/tauri-apps/tauri/issues/10025)

### portable-pty
- [docs.rs API Reference](https://docs.rs/portable-pty/latest/portable_pty/index.html)
- [MasterPty Trait](https://docs.rs/portable-pty/latest/portable_pty/trait.MasterPty.html)
- [CommandBuilder](https://docs.rs/portable-pty/latest/portable_pty/cmdbuilder/struct.CommandBuilder.html)
- [lib.rs Crate Page](https://lib.rs/crates/portable-pty)
- [Rust Forum: Reading PTY Output](https://users.rust-lang.org/t/how-to-just-get-the-shell-output-from-portable-pty/127607)

### axum
- [Axum 0.8.0 Announcement](https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0)
- [docs.rs API Reference](https://docs.rs/axum/latest/axum/)
- [Shared State Discussion](https://github.com/tokio-rs/axum/discussions/1897)

### @xterm/xterm v6
- [GitHub Repository](https://github.com/xtermjs/xterm.js)
- [Terminal Class API](https://xtermjs.org/docs/api/terminal/classes/terminal/)
- [Encoding Guide](https://xtermjs.org/docs/guides/encoding/)
- [Using Addons](https://xtermjs.org/docs/guides/using-addons/)
- [v6.0.0 Release Notes](https://github.com/xtermjs/xterm.js/releases)
- [Scoped Packages Migration Issue #4859](https://github.com/xtermjs/xterm.js/issues/4859)

### Zustand
- [Official Documentation](https://zustand.docs.pmnd.rs/)
- [v5 Migration Guide](https://github.com/pmndrs/zustand/blob/main/docs/migrations/migrating-to-v5.md)
- [v5.0.0 Release](https://github.com/pmndrs/zustand/releases/tag/v5.0.0)
- [Announcing Zustand v5](https://pmnd.rs/blog/announcing-zustand-v5)
- [Zustand v5 Deep Dive](https://react-news.com/mastering-state-management-a-deep-dive-into-zustand-v5-and-modern-react-patterns)
