import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import SessionView from "./components/SessionView";
import ProjectPicker from "./components/ProjectPicker";
import Settings from "./components/Settings";
import { useAppStore } from "./stores/appStore";
import { useThemeStore } from "./stores/themeStore";

function App() {
  const currentView = useAppStore((s) => s.currentView);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeProjectName = useAppStore((s) => s.activeProjectName);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setWindowProject = useAppStore((s) => s.setWindowProject);

  const initializedRef = useRef(false);

  // On mount, check URL query params for project context.
  // Project windows receive projectId, projectName, and projectPath via URL.
  // The picker window has no URL params.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    const projectName = params.get("projectName");
    const projectPath = params.get("projectPath");

    if (projectId && projectName) {
      setWindowProject(projectId);
      setActiveProject(
        projectId,
        decodeURIComponent(projectName),
        projectPath ? decodeURIComponent(projectPath) : undefined,
      );
      // Set view directly to session-view for project windows
      useAppStore.setState({ currentView: "session-view" });
    }

    // Initialize theme store from persisted backend settings
    invoke<{ app_theme?: string; terminal_theme?: string }>(
      "get_app_settings",
    ).then((settings) => {
      useThemeStore.getState().initialize(settings);
    }).catch(() => {
      // Use defaults if backend not available
      useThemeStore.getState().initialize({});
    });
  }, [setActiveProject, setWindowProject]);

  // Project windows: always show SessionView, no back navigation
  if (activeProjectId && currentView === "session-view") {
    return (
      <SessionView
        projectId={activeProjectId}
        projectName={activeProjectName ?? ""}
        projectPath={activeProjectPath ?? ""}
      />
    );
  }

  // Picker windows: show picker or settings
  switch (currentView) {
    case "settings":
      return <Settings />;
    case "picker":
    default:
      return <ProjectPicker />;
  }
}

export default App;
