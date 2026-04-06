import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock localStorage before importing themeStore
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(localStorageStore)) {
      delete localStorageStore[key];
    }
  }),
  get length() {
    return Object.keys(localStorageStore).length;
  },
  key: vi.fn((index: number) => Object.keys(localStorageStore)[index] ?? null),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

// Mock matchMedia
let mockMatchesDark = true;
let mediaChangeListeners: Array<() => void> = [];

const createMockMediaQueryList = (query: string) => ({
  matches: query.includes("dark") ? mockMatchesDark : !mockMatchesDark,
  media: query,
  addEventListener: vi.fn((_event: string, listener: () => void) => {
    mediaChangeListeners.push(listener);
  }),
  removeEventListener: vi.fn((_event: string, listener: () => void) => {
    mediaChangeListeners = mediaChangeListeners.filter((l) => l !== listener);
  }),
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query: string) => createMockMediaQueryList(query)),
});

function simulateOSThemeChange(dark: boolean) {
  mockMatchesDark = dark;
  for (const listener of [...mediaChangeListeners]) {
    listener();
  }
}

// Import after mocks are set up
import { useThemeStore } from "../themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    useThemeStore.setState({
      preference: "system",
      resolved: "dark",
      terminalTheme: "system",
    });
    mockMatchesDark = true;
    mediaChangeListeners = [];
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    mockLocalStorage.clear();
    mockLocalStorage.getItem.mockClear();
    mockLocalStorage.setItem.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setPreference", () => {
    it('sets resolved to "dark" and adds .dark class when preference is "dark"', () => {
      useThemeStore.getState().setPreference("dark");

      const state = useThemeStore.getState();
      expect(state.preference).toBe("dark");
      expect(state.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it('sets resolved to "light" and removes .dark class when preference is "light"', () => {
      document.documentElement.classList.add("dark");

      useThemeStore.getState().setPreference("light");

      const state = useThemeStore.getState();
      expect(state.preference).toBe("light");
      expect(state.resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it('resolves to "dark" when preference is "system" and OS prefers dark', () => {
      mockMatchesDark = true;

      useThemeStore.getState().setPreference("system");

      expect(useThemeStore.getState().resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it('resolves to "light" when preference is "system" and OS prefers light', () => {
      mockMatchesDark = false;

      useThemeStore.getState().setPreference("system");

      expect(useThemeStore.getState().resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("does NOT write to localStorage (only save does that)", () => {
      mockLocalStorage.setItem.mockClear();

      useThemeStore.getState().setPreference("dark");

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe("initialize", () => {
    it("sets preference and resolved from backend settings", () => {
      mockMatchesDark = false;

      useThemeStore.getState().initialize({ app_theme: "dark" });

      const state = useThemeStore.getState();
      expect(state.preference).toBe("dark");
      expect(state.resolved).toBe("dark");
    });

    it("sets terminalTheme from backend settings", () => {
      useThemeStore
        .getState()
        .initialize({ app_theme: "dark", terminal_theme: "light" });

      expect(useThemeStore.getState().terminalTheme).toBe("light");
    });

    it('defaults to "system" when app_theme is undefined', () => {
      mockMatchesDark = true;

      useThemeStore.getState().initialize({});

      const state = useThemeStore.getState();
      expect(state.preference).toBe("system");
      expect(state.resolved).toBe("dark");
    });

    it('defaults to "system" when app_theme is an invalid value', () => {
      mockMatchesDark = false;

      useThemeStore.getState().initialize({ app_theme: "invalid" });

      const state = useThemeStore.getState();
      expect(state.preference).toBe("system");
      expect(state.resolved).toBe("light");
    });

    it('defaults terminal_theme to "system" when invalid', () => {
      useThemeStore
        .getState()
        .initialize({ app_theme: "dark", terminal_theme: "auto" });

      expect(useThemeStore.getState().terminalTheme).toBe("system");
    });

    it("mirrors preference to localStorage", () => {
      useThemeStore.getState().initialize({ app_theme: "dark" });

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "seance-theme",
        "dark",
      );
    });

    it("applies theme to DOM", () => {
      useThemeStore.getState().initialize({ app_theme: "light" });

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe("light");
    });
  });

  describe("mediaListener lifecycle", () => {
    it('attaches listener when preference is "system"', () => {
      useThemeStore.getState().setPreference("system");

      expect(mediaChangeListeners.length).toBe(1);
    });

    it('detaches listener when switching from "system" to "dark"', () => {
      useThemeStore.getState().setPreference("system");
      expect(mediaChangeListeners.length).toBe(1);

      useThemeStore.getState().setPreference("dark");
      expect(mediaChangeListeners.length).toBe(0);
    });

    it("updates resolved theme when OS preference changes and preference is system", () => {
      mockMatchesDark = true;
      useThemeStore.getState().setPreference("system");
      expect(useThemeStore.getState().resolved).toBe("dark");

      simulateOSThemeChange(false);

      expect(useThemeStore.getState().resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("does not accumulate listeners on repeated system preference sets", () => {
      useThemeStore.getState().setPreference("system");
      useThemeStore.getState().setPreference("system");
      useThemeStore.getState().setPreference("system");

      expect(mediaChangeListeners.length).toBe(1);
    });

    it('does not react to OS changes when preference is "dark"', () => {
      mockMatchesDark = true;
      useThemeStore.getState().setPreference("dark");

      simulateOSThemeChange(false);

      expect(useThemeStore.getState().resolved).toBe("dark");
    });
  });

  describe("setTerminalTheme", () => {
    it("updates terminalTheme state", () => {
      useThemeStore.getState().setTerminalTheme("light");

      expect(useThemeStore.getState().terminalTheme).toBe("light");
    });

    it("does not affect resolved or preference", () => {
      useThemeStore.getState().setPreference("dark");
      useThemeStore.getState().setTerminalTheme("light");

      expect(useThemeStore.getState().preference).toBe("dark");
      expect(useThemeStore.getState().resolved).toBe("dark");
    });
  });
});
