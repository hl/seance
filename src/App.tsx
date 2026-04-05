import { useState, useCallback } from "react";
import SessionView from "./components/SessionView";

function App() {
  // Temporary: single-project mode until Unit 7 adds the Project Picker.
  // Using a placeholder project to let SessionView render.
  const [activeProject, setActiveProject] = useState<{
    id: string;
    name: string;
  } | null>({ id: "default-project", name: "Séance" });

  const handleBack = useCallback(() => {
    setActiveProject(null);
  }, []);

  if (!activeProject) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950">
        <button
          type="button"
          onClick={() =>
            setActiveProject({ id: "default-project", name: "Séance" })
          }
          className="rounded-lg bg-neutral-800 px-6 py-3 text-lg font-semibold text-neutral-100 transition-colors hover:bg-neutral-700"
        >
          Open Project
        </button>
      </div>
    );
  }

  return (
    <SessionView
      projectId={activeProject.id}
      projectName={activeProject.name}
      onBack={handleBack}
    />
  );
}

export default App;
