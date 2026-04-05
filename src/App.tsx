import SessionView from "./components/SessionView";
import ProjectPicker from "./components/ProjectPicker";
import Settings from "./components/Settings";
import { useAppStore } from "./stores/appStore";

function App() {
  const currentView = useAppStore((s) => s.currentView);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeProjectName = useAppStore((s) => s.activeProjectName);
  const navigateToPicker = useAppStore((s) => s.navigateToPicker);

  switch (currentView) {
    case "session-view":
      return (
        <SessionView
          projectId={activeProjectId ?? ""}
          projectName={activeProjectName ?? ""}
          onBack={navigateToPicker}
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
