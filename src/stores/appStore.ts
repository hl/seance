import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

type AppView = "picker" | "session-view" | "settings";

interface AppState {
  currentView: AppView;
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectPath: string | null;

  /** The project this window was opened for (set from URL params). */
  windowProjectId: string | null;

  navigateToProject: (id: string, name: string, path?: string) => void;
  navigateToPicker: () => void;
  navigateToSettings: () => void;
  setActiveProject: (id: string, name: string) => void;
  setWindowProject: (id: string | null) => void;
  openProjectInNewWindow: (id: string, name: string) => Promise<void>;
}

export const useAppStore = create<AppState>()((set, get) => ({
  currentView: "picker",
  activeProjectId: null,
  activeProjectName: null,
  activeProjectPath: null,
  windowProjectId: null,

  navigateToProject: (id: string, name: string, path?: string) => {
    const state = get();
    // Only open a new window if this window was opened specifically for
    // a DIFFERENT project via URL params (multi-window scenario).
    // The windowProjectId is set only when a window is opened via
    // open_project_window with query params.
    if (state.windowProjectId && state.windowProjectId !== id) {
      void get().openProjectInNewWindow(id, name);
      return;
    }

    set({
      currentView: "session-view",
      activeProjectId: id,
      activeProjectName: name,
      activeProjectPath: path ?? null,
    });
  },

  navigateToPicker: () => {
    set({
      currentView: "picker",
    });
  },

  navigateToSettings: () => {
    set({ currentView: "settings" });
  },

  setActiveProject: (id: string, name: string) => {
    set({ activeProjectId: id, activeProjectName: name });
  },

  setWindowProject: (id: string | null) => {
    set({ windowProjectId: id });
  },

  openProjectInNewWindow: async (id: string, name: string) => {
    try {
      await invoke("open_project_window", {
        projectId: id,
        projectName: name,
      });
    } catch (err) {
      console.error("Failed to open project window:", err);
      // Fall back to opening in current window if new window fails
      set({
        currentView: "session-view",
        activeProjectId: id,
        activeProjectName: name,
      });
    }
  },
}));
