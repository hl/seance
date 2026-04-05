import { create } from "zustand";

type AppView = "picker" | "session-view" | "settings";

interface AppState {
  currentView: AppView;
  activeProjectId: string | null;
  activeProjectName: string | null;

  navigateToProject: (id: string, name: string) => void;
  navigateToPicker: () => void;
  navigateToSettings: () => void;
  setActiveProject: (id: string, name: string) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  currentView: "picker",
  activeProjectId: null,
  activeProjectName: null,

  navigateToProject: (id: string, name: string) => {
    set({
      currentView: "session-view",
      activeProjectId: id,
      activeProjectName: name,
    });
  },

  navigateToPicker: () => {
    set({
      currentView: "picker",
      activeProjectId: null,
      activeProjectName: null,
    });
  },

  navigateToSettings: () => {
    set({ currentView: "settings" });
  },

  setActiveProject: (id: string, name: string) => {
    set({ activeProjectId: id, activeProjectName: name });
  },
}));
