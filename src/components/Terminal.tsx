import { type FC, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { useTerminal } from "../hooks/useTerminal";
import { useSessionStore } from "../stores/sessionStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  isVisible?: boolean;
}

const TerminalView: FC<TerminalViewProps> = ({ isVisible = true }) => {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  // Track lastStartedAt so the effect re-runs when a session is restarted
  // (activeSessionId stays the same, but the PTY is new and needs re-subscription).
  const activeSessionStartedAt = useSessionStore((s) => {
    if (!s.activeSessionId) return null;
    return s.sessions.get(s.activeSessionId)?.lastStartedAt ?? null;
  });
  const { terminalRef, writeData, reset, fit, fitAndGetDimensions, onData, isReady } =
    useTerminal(activeSessionId);
  const channelRef = useRef<Channel<number[]> | null>(null);
  const [subscribeError, setSubscribeError] = useState(false);

  // Session switching: reset terminal, subscribe to output, replay scrollback.
  // Also re-runs when activeSessionStartedAt changes (session restarted).
  useEffect(() => {
    if (!activeSessionId || !isReady) return;

    // Reset terminal for new session
    reset();
    setSubscribeError(false);

    // Create a new channel for live output
    const channel = new Channel<number[]>();
    channel.onmessage = (data) => {
      writeData(new Uint8Array(data));
    };
    channelRef.current = channel;

    // Subscribe to output: returns scrollback, then channel receives live data
    let cancelled = false;
    async function subscribeToSession() {
      try {
        const scrollback = await invoke<number[]>("subscribe_output", {
          sessionId: activeSessionId,
          onOutput: channel,
        });
        if (!cancelled) {
          writeData(new Uint8Array(scrollback));
          // Fit the terminal and sync PTY dimensions
          const dims = fitAndGetDimensions();
          if (dims && activeSessionId) {
            invoke("resize_pty", {
              sessionId: activeSessionId,
              cols: dims.cols,
              rows: dims.rows,
            }).catch(() => {});
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to subscribe to session output:", err);
          setSubscribeError(true);
        }
      }
    }

    subscribeToSession();

    return () => {
      cancelled = true;
      channelRef.current = null;
    };
  }, [activeSessionId, activeSessionStartedAt, isReady, writeData, reset, fit, fitAndGetDimensions]);

  // Forward terminal input to PTY
  useEffect(() => {
    if (!activeSessionId || !isReady) return;

    const dispose = onData((data: string) => {
      invoke("send_input", {
        sessionId: activeSessionId,
        data,
      }).catch(() => {
        // Backend not available yet
      });
    });

    return dispose;
  }, [activeSessionId, isReady, onData]);

  // Re-fit and refresh when the terminal tab becomes visible again.
  // xterm.js cannot measure dimensions while display:none, so it needs
  // a fit() + refresh() once the container is shown.
  useEffect(() => {
    if (isVisible && isReady) {
      // Small delay to let the browser finish layout after display:block
      const timer = setTimeout(() => {
        fit();
        // Force a full repaint of all rows
        const term = (terminalRef as any).current?.querySelector?.("textarea")?.closest?.(".xterm");
        if (term) {
          // The underlying terminal instance is stored in useTerminal —
          // fit() already triggers a refresh via the FitAddon, but we
          // also sync the PTY size in case it drifted.
          if (activeSessionId) {
            const dims = fitAndGetDimensions();
            if (dims) {
              invoke("resize_pty", {
                sessionId: activeSessionId,
                cols: dims.cols,
                rows: dims.rows,
              }).catch(() => {});
            }
          }
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible, isReady, fit, fitAndGetDimensions, activeSessionId]);

  return (
    <div className="relative flex-1 overflow-hidden bg-bg">
      {/* Terminal container — always mounted so useTerminal can attach */}
      <div
        ref={terminalRef}
        className="h-full w-full p-1"
        style={{ display: activeSessionId ? "block" : "none" }}
      />

      {/* Empty state overlay — shown when no session is active */}
      {!activeSessionId && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-text-muted">
            Select a session or create a new one.
          </p>
        </div>
      )}

      {subscribeError && (
        <div className="absolute bottom-2 left-2 rounded bg-red-100/80 px-3 py-1 text-xs text-red-800 dark:bg-red-900/80 dark:text-red-200">
          Failed to connect to session. Try switching sessions.
        </div>
      )}
    </div>
  );
};

export default TerminalView;
