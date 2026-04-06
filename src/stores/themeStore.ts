import { create } from "zustand";

type ThemePreference = "system" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  terminalTheme: ThemePreference;

  initialize: (settings: {
    app_theme?: string;
    terminal_theme?: string;
  }) => void;
  setPreference: (pref: ThemePreference) => void;
  setTerminalTheme: (theme: ThemePreference) => void;
}

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
let storageListenerAttached = false;

const VALID_PREFERENCES = ["system", "dark", "light"] as const;

function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === "string" && VALID_PREFERENCES.includes(v as ThemePreference);
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  // "system" — check OS preference
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyThemeToDOM(resolved: ResolvedTheme): void {
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  document.documentElement.style.colorScheme = resolved;
}

function detachMediaListener(): void {
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaListener = null;
  }
}

function attachMediaListener(): void {
  detachMediaListener();
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaListener = () => {
    const state = useThemeStore.getState();
    if (state.preference === "system") {
      const resolved = resolveTheme("system");
      useThemeStore.setState({ resolved });
      applyThemeToDOM(resolved);
    }
  };
  mediaQuery.addEventListener("change", mediaListener);
}

export const useThemeStore = create<ThemeState>()((set) => ({
  preference: "system",
  resolved: "dark",
  terminalTheme: "system",

  initialize: (settings) => {
    const pref = isThemePreference(settings.app_theme) ? settings.app_theme : "system";
    const termTheme = isThemePreference(settings.terminal_theme) ? settings.terminal_theme : "system";
    const resolved = resolveTheme(pref);

    set({ preference: pref, resolved, terminalTheme: termTheme });
    applyThemeToDOM(resolved);

    // Mirror to localStorage so the blocking <script> has it on next launch
    localStorage.setItem("seance-theme", pref);

    if (pref === "system") {
      attachMediaListener();
    } else {
      detachMediaListener();
    }

    // Listen for theme changes from other windows via localStorage "storage" event.
    // The "storage" event only fires in OTHER windows, not the one that wrote the key.
    if (!storageListenerAttached) {
      storageListenerAttached = true;
      window.addEventListener("storage", (e) => {
        if (e.key === "seance-theme" && e.newValue && isThemePreference(e.newValue)) {
          const newPref = e.newValue as ThemePreference;
          const newResolved = resolveTheme(newPref);
          useThemeStore.setState({ preference: newPref, resolved: newResolved });
          applyThemeToDOM(newResolved);
          if (newPref === "system") {
            attachMediaListener();
          } else {
            detachMediaListener();
          }
        }
      });
    }
  },

  setPreference: (pref) => {
    const resolved = resolveTheme(pref);
    set({ preference: pref, resolved });
    applyThemeToDOM(resolved);

    // Mirror to localStorage so other windows pick it up via "storage" event
    try {
      localStorage.setItem("seance-theme", pref);
    } catch {
      // localStorage may be unavailable
    }

    if (pref === "system") {
      attachMediaListener();
    } else {
      detachMediaListener();
    }
  },

  setTerminalTheme: (theme) => {
    set({ terminalTheme: theme });
  },
}));
