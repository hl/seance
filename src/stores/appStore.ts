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

  navigateToPicker: () => void;
  navigateToSettings: () => void;
  setActiveProject: (id: string, name: string, path?: string) => void;
  setWindowProject: (id: string | null) => void;
  openProjectInNewWindow: (id: string, name: string) => Promise<void>;
}

export const useAppStore = create<AppState>()((set) => ({
  currentView: "picker",
  activeProjectId: null,
  activeProjectName: null,
  activeProjectPath: null,
  windowProjectId: null,

  navigateToPicker: () => {
    set({
      currentView: "picker",
    });
  },

  navigateToSettings: () => {
    set({ currentView: "settings" });
  },

  setActiveProject: (id: string, name: string, path?: string) => {
    set({
      activeProjectId: id,
      activeProjectName: name,
      activeProjectPath: path ?? null,
    });
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
      // Fallback: open project in current window if new window fails
      set({
        currentView: "session-view" as AppView,
        activeProjectId: id,
        activeProjectName: name,
      });
    }
  },
}));
