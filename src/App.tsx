import { useEffect, useRef } from "react";
import SessionView from "./components/SessionView";
import ProjectPicker from "./components/ProjectPicker";
import Settings from "./components/Settings";
import { useAppStore } from "./stores/appStore";

function App() {
  const currentView = useAppStore((s) => s.currentView);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeProjectName = useAppStore((s) => s.activeProjectName);
  const navigateToProject = useAppStore((s) => s.navigateToProject);
  const navigateToPicker = useAppStore((s) => s.navigateToPicker);
  const setWindowProject = useAppStore((s) => s.setWindowProject);

  const initializedRef = useRef(false);

  // On mount, check URL query params for project context.
  // This is how newly opened project windows know which project to show.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    const projectName = params.get("projectName");

    if (projectId && projectName) {
      setWindowProject(projectId);
      navigateToProject(projectId, decodeURIComponent(projectName));
    }
  }, [navigateToProject, setWindowProject]);

  // Back button handler: if this window was opened for a specific project,
  // navigating back shows the picker in the same window. From the picker,
  // clicking the same project goes back to its session view, clicking a
  // different project opens a new window.
  const handleBack = () => {
    navigateToPicker();
  };

  // When in the picker and this window has a "home" project, clicking
  // that same project should go back to the session view (not open a new
  // window). This is handled by navigateToProject in the store which
  // checks if activeProjectId matches.

  switch (currentView) {
    case "session-view":
      return (
        <SessionView
          projectId={activeProjectId ?? ""}
          projectName={activeProjectName ?? ""}
          onBack={handleBack}
        />
      );
    case "settings":
      return <Settings />;
    case "picker":
    default:
      return <ProjectPicker />;
  }
}

export default App;
