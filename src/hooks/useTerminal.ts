import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/sessionStore";

export interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  writeData: (data: string | Uint8Array) => void;
  reset: () => void;
  fit: () => void;
  onData: (handler: (data: string) => void) => (() => void) | undefined;
}

export function useTerminal(activeSessionId: string | null): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#f5f5f5",
        cursor: "#f5f5f5",
        selectionBackground: "#404040",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Try WebGL renderer, fall back to DOM
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL not available — DOM renderer is the default fallback
    }

    fitAddon.fit();

    // Intercept Cmd+1-9 for session switching
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (
        ev.metaKey &&
        ev.key >= "1" &&
        ev.key <= "9" &&
        ev.type === "keydown"
      ) {
        const index = parseInt(ev.key, 10) - 1;
        useSessionStore.getState().switchToIndex(index);
        return false;
      }
      return true;
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // ResizeObserver for auto-fit and PTY resize notification
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      const sid = useSessionStore.getState().activeSessionId;
      if (dims && sid) {
        invoke("resize_pty", {
          sessionId: sid,
          cols: dims.cols,
          rows: dims.rows,
        }).catch(() => {
          // Backend not available yet
        });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Re-fit when active session changes (terminal may have been hidden)
  useEffect(() => {
    if (activeSessionId) {
      fitAddonRef.current?.fit();
    }
  }, [activeSessionId]);

  const writeData = useCallback((data: string | Uint8Array) => {
    termRef.current?.write(data);
  }, []);

  const reset = useCallback(() => {
    termRef.current?.reset();
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const onData = useCallback(
    (handler: (data: string) => void): (() => void) | undefined => {
      const disposable = termRef.current?.onData(handler);
      return disposable ? () => disposable.dispose() : undefined;
    },
    [],
  );

  return {
    terminalRef: containerRef,
    writeData,
    reset,
    fit,
    onData,
  };
}
