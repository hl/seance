import { type FC, useEffect, useRef } from "react";
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

  useSessionEvents(activeSessionId);

  // Session switching: reset terminal, subscribe to output, replay scrollback
  useEffect(() => {
    if (!activeSessionId) return;

    // Reset terminal for new session
    reset();

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
      } catch {
        // Backend not available yet — will be wired in a later unit
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

  if (!activeSessionId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-neutral-950">
        <p className="text-neutral-500">
          No sessions yet. Create one to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden bg-neutral-950 p-1">
      <div ref={terminalRef} className="h-full w-full" />
    </div>
  );
};

export default TerminalView;
