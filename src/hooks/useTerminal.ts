import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/sessionStore";
import { useThemeStore } from "../stores/themeStore";

const DARK_TERMINAL_THEME = {
  background: "#0f0a14",
  foreground: "#f0eaf5",
  cursor: "#f0eaf5",
  selectionBackground: "#2d2340",
};

const LIGHT_TERMINAL_THEME = {
  background: "#faf6f0",
  foreground: "#2a1f3d",
  cursor: "#2a1f3d",
  selectionBackground: "#d4c7b680",
};

type ThemePreference = "system" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

function getTerminalTheme(
  terminalTheme: ThemePreference,
  resolved: ResolvedTheme,
): typeof DARK_TERMINAL_THEME {
  if (terminalTheme === "dark") return DARK_TERMINAL_THEME;
  if (terminalTheme === "light") return LIGHT_TERMINAL_THEME;
  // "system" — follow the resolved app theme
  return resolved === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

export interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  writeData: (data: string | Uint8Array) => void;
  reset: () => void;
  fit: () => void;
  fitAndGetDimensions: () => { cols: number; rows: number } | null;
  onData: (handler: (data: string) => void) => (() => void) | undefined;
  isReady: boolean;
}

export function useTerminal(activeSessionId: string | null): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const initializedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  // Create terminal once when container is available. Never dispose on
  // session switch — just reset() the content. This avoids xterm.js
  // _isDisposed crashes from rapid create/dispose cycles.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;

    // Wait for the container to have dimensions (may be hidden initially)
    const checkAndInit = () => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

      const { terminalTheme, resolved } = useThemeStore.getState();
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 14,
        fontFamily:
          "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
        theme: getTerminalTheme(terminalTheme, resolved),
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => webglAddon.dispose());
        term.loadAddon(webglAddon);
      } catch {
        // WebGL not available
      }

      try {
        fitAddon.fit();
      } catch {
        // fit can fail during init
      }

      term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
        if (
          ev.metaKey &&
          ev.key >= "1" &&
          ev.key <= "9" &&
          ev.type === "keydown"
        ) {
          useSessionStore.getState().switchToIndex(parseInt(ev.key, 10) - 1);
          return false;
        }
        return true;
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      initializedRef.current = true;
      setIsReady(true);

      const observer = new ResizeObserver(() => {
        try {
          if (container.offsetWidth > 0 && container.offsetHeight > 0) {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            const sid = useSessionStore.getState().activeSessionId;
            if (dims && sid) {
              invoke("resize_pty", {
                sessionId: sid,
                cols: dims.cols,
                rows: dims.rows,
              }).catch(() => {});
            }
          }
        } catch {
          // ignore
        }
      });
      observer.observe(container);
      observerRef.current = observer;
    };

    // Try immediately, then use a MutationObserver to detect when
    // the container becomes visible (when display changes from none)
    checkAndInit();
    if (!initializedRef.current) {
      const mo = new MutationObserver(() => {
        if (!initializedRef.current) checkAndInit();
        if (initializedRef.current) mo.disconnect();
      });
      mo.observe(container, { attributes: true, attributeFilter: ["style"] });
      // Also try on next frames in case style is set by React reconciliation
      const tryFrames = () => {
        if (!initializedRef.current) {
          checkAndInit();
          if (!initializedRef.current) requestAnimationFrame(tryFrames);
        }
      };
      requestAnimationFrame(tryFrames);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      // Defer disposal to avoid races with other effects' cleanup.
      // The terminal is no longer usable after this component unmounts.
      const term = termRef.current;
      termRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      setIsReady(false);
      if (term) {
        setTimeout(() => {
          try {
            term.dispose();
          } catch {
            // Already disposed or partially cleaned up
          }
        }, 0);
      }
    };
  }, []); // Mount once, clean up on unmount

  // React to theme changes — live-patch the terminal theme
  const resolved = useThemeStore((s) => s.resolved);
  const terminalTheme = useThemeStore((s) => s.terminalTheme);
  useEffect(() => {
    if (termRef.current && initializedRef.current) {
      termRef.current.options.theme = getTerminalTheme(
        terminalTheme,
        resolved,
      );
    }
  }, [resolved, terminalTheme]);

  // Re-fit when session changes (terminal may need resizing)
  useEffect(() => {
    if (activeSessionId && initializedRef.current) {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    }
  }, [activeSessionId]);

  const writeData = useCallback((data: string | Uint8Array) => {
    termRef.current?.write(data);
  }, []);

  const reset = useCallback(() => {
    termRef.current?.reset();
  }, []);

  const fit = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // ignore
    }
  }, []);

  const fitAndGetDimensions = useCallback((): { cols: number; rows: number } | null => {
    try {
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) return { cols: dims.cols, rows: dims.rows };
    } catch {
      // ignore
    }
    return null;
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
    fitAndGetDimensions,
    fit,
    onData,
    isReady,
  };
}
