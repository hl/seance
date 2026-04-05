import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

type AppView = "picker" | "session-view" | "settings";

interface AppState {
  currentView: AppView;
  activeProjectId: string | null;
  activeProjectName: string | null;

  /** The project this window was opened for (set from URL params). */
  windowProjectId: string | null;

  navigateToProject: (id: string, name: string) => void;
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
  windowProjectId: null,

  navigateToProject: (id: string, name: string) => {
    const state = get();
    // If this window "belongs" to a different project (set via URL params
    // or from a previous session view), open the new project in a new
    // window instead. This covers both:
    // 1. Pressing back from session view to picker, then clicking a
    //    different project -> new window.
    // 2. Being in session view and somehow navigating to a different
    //    project -> new window.
    //
    // Clicking the *same* project always stays in this window.
    const ownerProjectId = state.windowProjectId ?? state.activeProjectId;
    if (ownerProjectId !== null && ownerProjectId !== id) {
      // Fire-and-forget — open in new window.
      void get().openProjectInNewWindow(id, name);
      return;
    }

    set({
      currentView: "session-view",
      activeProjectId: id,
      activeProjectName: name,
    });
  },

  navigateToPicker: () => {
    set({
      currentView: "picker",
      // Keep activeProjectId so we know which project "belongs" to this window.
      // This enables the "click same project = go back to session view" behavior.
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
