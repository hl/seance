import { type FC, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { useTerminal } from "../hooks/useTerminal";
import { useSessionStore } from "../stores/sessionStore";
import { useSessionEvents } from "../hooks/useSessionEvents";
import "@xterm/xterm/css/xterm.css";

const TerminalView: FC = () => {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const { terminalRef, writeData, reset, fit, onData } =
    useTerminal(activeSessionId);
  const channelRef = useRef<Channel<number[]> | null>(null);
  const [subscribeError, setSubscribeError] = useState(false);

  useSessionEvents(activeSessionId);

  // Session switching: reset terminal, subscribe to output, replay scrollback
  useEffect(() => {
    if (!activeSessionId) return;

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
          fit();
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
  }, [activeSessionId, writeData, reset, fit]);

  // Forward terminal input to PTY
  useEffect(() => {
    if (!activeSessionId) return;

    const dispose = onData((data: string) => {
      invoke("send_input", {
        sessionId: activeSessionId,
        data,
      }).catch(() => {
        // Backend not available yet
      });
    });

    return dispose;
  }, [activeSessionId, onData]);

  return (
    <div className="relative flex-1 overflow-hidden bg-neutral-950">
      {/* Terminal container — always mounted so useTerminal can attach */}
      <div
        ref={terminalRef}
        className="h-full w-full p-1"
        style={{ display: activeSessionId ? "block" : "none" }}
      />

      {/* Empty state overlay — shown when no session is active */}
      {!activeSessionId && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-neutral-500">
            No agents yet. Create one to get started.
          </p>
        </div>
      )}

      {subscribeError && (
        <div className="absolute bottom-2 left-2 rounded bg-red-900/80 px-3 py-1 text-xs text-red-200">
          Failed to connect to session. Try switching sessions.
        </div>
      )}
    </div>
  );
};

export default TerminalView;
