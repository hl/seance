---
title: "Tauri v2 PTY Streaming and Desktop Lifecycle Architecture"
date: 2026-04-05
category: best-practices
module: desktop-terminal-emulator
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Building Tauri v2 desktop apps that embed interactive terminal sessions
  - Streaming unbounded blocking I/O (PTY reads) alongside a tokio async runtime
  - Implementing session switching with live terminal output in xterm.js
  - Managing child process lifecycle (spawn, signal, cleanup) from a Tauri backend
  - Running an auxiliary HTTP server (axum) within a Tauri application
  - Handling macOS dock lifecycle events (close-to-dock, reopen)
tags:
  - tauri-v2
  - pty
  - xterm-js
  - portable-pty
  - terminal-emulation
  - process-management
  - rust-async
  - macos-desktop
---

# Tauri v2 PTY Streaming and Desktop Lifecycle Architecture

## Context

Building a Tauri v2 desktop app that embeds fully interactive terminal emulators requires solving several non-obvious architectural problems: threading model for blocking PTY I/O, IPC mechanism for streaming bytes to the frontend, preventing data loss during session switching, managing child process lifecycle, and running an HTTP server alongside the Tauri runtime. These problems interact — a poor choice in one area (e.g., using tokio's blocking thread pool for PTY reads) creates cascading failures in others (thread pool exhaustion under many sessions).

These patterns were discovered during the implementation of Séance, an AI agent session orchestrator. They are extracted here as reusable guidance for any Tauri v2 + PTY terminal project.

## Guidance

### 1. PTY Reader Threading: Dedicated OS Threads, Not Tokio

`portable-pty` (0.9.x) exposes a blocking `Read` trait on its reader. Use `std::thread::spawn` for a dedicated OS thread per PTY session, bridged to async via `tokio::sync::mpsc`. Do **not** use `tokio::spawn_blocking` — it is designed for bounded blocking work and draws from tokio's limited blocking thread pool (default 512 threads). With many concurrent sessions, this leads to thread pool exhaustion.

This is the same pattern WezTerm uses internally.

```rust
let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    let mut batch = Vec::with_capacity(8192);
    let mut last_flush = std::time::Instant::now();

    loop {
        match pty_reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                batch.extend_from_slice(&buf[..n]);
                if batch.len() >= 200_000
                    || last_flush.elapsed() >= Duration::from_millis(8)
                {
                    let _ = tx.blocking_send(std::mem::take(&mut batch));
                    last_flush = std::time::Instant::now();
                }
            }
            Err(_) => break,
        }
    }
});
```

### 2. Tauri IPC: Channels for Streaming, Events for Status

Use Tauri Channels (`Channel<Vec<u8>>`) for streaming PTY output. Unlike Events, Channels are ordered and designed for streaming — Tauri uses them internally for child process output. Use Events (`emit_to`, `emit`) for infrequent status updates where broadcast semantics are useful.

### 3. Output Batching: 8ms / 200KB Windows

Accumulate PTY output in the reader thread for 8ms or 200KB (whichever comes first) before sending. Empirically validated by Hyper terminal's batching PR: 57% throughput improvement, consistent 40+ FPS. Without batching, per-read sends overwhelm the IPC bridge and cause dropped frames.

### 4. Atomic Session Switching

The naive approach — `get_scrollback()` then `subscribe()` — loses output produced between the two calls. The solution: a single `subscribe_output` command that atomically snapshots the scrollback buffer AND attaches the new Channel under the same lock.

```rust
// Single lock: snapshot + channel swap
let scrollback = session.scrollback.snapshot();
session.attach_channel(new_channel);
Ok(scrollback) // frontend writes this, then channel delivers live output
```

### 5. Scrollback as Raw Bytes with Byte Cap

Store raw PTY output in a `Vec<u8>` with an 8MB byte cap — not a line count. Terminal lines vary from 80 bytes to several KB (escape sequences, wide characters). A byte cap is predictable for memory budgeting. On replay, write the entire buffer to xterm.js as `Uint8Array`. xterm.js handles large writes asynchronously via its internal `WriteBuffer`.

### 6. axum on Tauri's Runtime

Spawn axum via `tauri::async_runtime::spawn()` in the setup hook. Both Tauri and axum use tokio — no separate runtime needed. Share state via `Arc`.

```rust
tauri::Builder::default()
    .setup(|app| {
        let state = Arc::new(AppState::new());
        let state_for_axum = state.clone();
        tauri::async_runtime::spawn(async move {
            let router = Router::new()
                .route("/hooks", post(handle))
                .with_state(state_for_axum);
            let listener = TcpListener::bind("127.0.0.1:7837").await.unwrap();
            axum::serve(listener, router).await.unwrap();
        });
        app.manage(state);
        Ok(())
    })
```

### 7. Process Cleanup: Multi-Layer Defense

Orphaned child processes running after app crash is a meaningful failure mode. Multi-layer approach:

- **SIGHUP to process groups** via `killpg` using `process_group_leader()` (not child PID)
- **500ms grace period** then **SIGKILL** survivors
- **PID persistence** in JSON for orphan cleanup on next launch
- **`signal-hook`** crate for SIGTERM/SIGINT handling

### 8. macOS Dock Lifecycle

Use `.build().expect().run(|app_handle, event| {...})` — not `.run().expect()`:

```rust
app.run(|_app_handle, event| match event {
    RunEvent::ExitRequested { code, api, .. } => {
        if code.is_none() {
            api.prevent_exit(); // all windows closed, stay in dock
        }
    }
    RunEvent::Reopen { has_visible_windows, .. } => {
        if !has_visible_windows {
            // reopen main window
        }
    }
    RunEvent::Exit => { /* kill all PTY processes */ }
    _ => {}
});
```

### 9. xterm.js v6 in Tauri

- Scoped packages: `@xterm/xterm`, `@xterm/addon-webgl`, `@xterm/addon-fit`
- WebGL addon for rendering performance (fall back to DOM if context creation fails)
- `attachCustomKeyEventHandler()` for intercepting shortcuts — not Tauri global shortcuts (double-fire on macOS)

### 10. Tailwind CSS v4 in Tauri/Vite

No `tailwind.config.ts` — v4 uses CSS-first config: `@import "tailwindcss"` in CSS, `@tailwindcss/vite` plugin. Custom values via `@theme { ... }` in CSS.

## Why This Matters

These patterns prevent several non-obvious failure modes:

- **Tokio thread pool exhaustion** from unbounded PTY reads on `spawn_blocking`
- **Data loss during session switching** from the get-then-subscribe race condition
- **Orphaned child processes** consuming resources after app crash
- **macOS dock behavior violations** causing unexpected app termination
- **Dropped frames and input lag** from un-batched terminal output flooding IPC

Most are not documented together elsewhere. They were discovered by cross-referencing patterns from WezTerm, Hyper terminal, and Tauri's internal IPC design.

## When to Apply

- Building any Tauri v2 app with embedded terminal emulators
- Integrating `portable-pty` with an async Rust runtime
- Running an HTTP server alongside Tauri
- Managing child process lifecycle where orphaned processes have real cost
- Targeting macOS as a primary platform

## Examples

See the implementation in this repository:
- PTY engine: `src-tauri/src/pty_engine.rs`
- Scrollback buffer: `src-tauri/src/scrollback.rs`
- Hook server: `src-tauri/src/hook_server.rs`
- Process cleanup: `src-tauri/src/cleanup.rs`
- macOS lifecycle: `src-tauri/src/lib.rs`
- Terminal component: `src/components/Terminal.tsx`
- Session switching: `src/hooks/useTerminal.ts`

## Related

- Origin plan: `docs/plans/2026-04-05-001-feat-seance-v1-plan.md`
- Stack research: `docs/research/2026-04-05-stack-documentation.md`
- Requirements: `docs/brainstorms/2026-04-05-seance-v1-requirements.md`
- [Tauri v2 Calling Frontend (Channels)](https://v2.tauri.app/develop/calling-frontend/)
- [WezTerm PTY architecture](https://deepwiki.com/wezterm/wezterm/4.5-pty-and-process-management)
- [Hyper terminal batching PR](https://github.com/vercel/hyper/pull/3336)
