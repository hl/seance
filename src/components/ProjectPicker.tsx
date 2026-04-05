import { type FC, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../stores/appStore";
import { useProjects, type ProjectData } from "../hooks/useProjects";
import ProjectCard from "./ProjectCard";
import ProjectSettings from "./ProjectSettings";

function projectNameFromPath(path: string): string {
  // Get the last non-empty segment of the path
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

const ProjectPicker: FC = () => {
  const navigateToProject = useAppStore((s) => s.navigateToProject);
  const navigateToSettings = useAppStore((s) => s.navigateToSettings);
  const { projects, loading, refresh } = useProjects();

  const [settingsProject, setSettingsProject] = useState<ProjectData | null>(
    null,
  );

  const handleAddProject = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    try {
      const project = await invoke<ProjectData>("add_project", {
        path: selected,
      });
      await refresh();
      // Open settings for the newly added project
      setSettingsProject(project);
    } catch (err) {
      console.error("Failed to add project:", err);
    }
  }, [refresh]);

  const handleRemoveProject = useCallback(
    async (project: ProjectData) => {
      if (project.active_session_count > 0) {
        const confirmed = await confirm(
          `This project has ${project.active_session_count} active session(s). Removing it will kill all sessions. Continue?`,
          { title: "Remove Project", kind: "warning" },
        );
        if (!confirmed) return;
      }

      try {
        await invoke("remove_project", { id: project.id });
        await refresh();
      } catch (err) {
        console.error("Failed to remove project:", err);
      }
    },
    [refresh],
  );

  const handleCardClick = useCallback(
    (project: ProjectData) => {
      const name = project.name || projectNameFromPath(project.path);
      navigateToProject(project.id, name, project.path);
    },
    [navigateToProject],
  );

  const handleOpenSettings = useCallback((project: ProjectData) => {
    setSettingsProject(project);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsProject(null);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-neutral-950">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold text-neutral-100">
          S&eacute;ance
        </h1>
        <button
          type="button"
          onClick={navigateToSettings}
          className="rounded px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          title="App settings"
        >
          &#9881;
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-neutral-500">Loading projects...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  id={project.id}
                  name={project.name || projectNameFromPath(project.path)}
                  path={project.path}
                  activeSessionCount={project.active_session_count}
                  sessionIds={project.sessions.map((s) => s.id)}
                  onClick={() => handleCardClick(project)}
                  onRemove={() => handleRemoveProject(project)}
                  onSettings={() => handleOpenSettings(project)}
                />
              ))}

              {/* Add Project button */}
              <button
                type="button"
                onClick={handleAddProject}
                className="w-full rounded-lg border-2 border-dashed border-neutral-800 px-4 py-4 text-sm text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-300"
              >
                + Add Project
              </button>

              {projects.length === 0 && !loading && (
                <p className="pt-4 text-center text-xs text-neutral-600">
                  No projects yet. Click &ldquo;+ Add Project&rdquo; to get
                  started.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Project Settings modal */}
      {settingsProject && (
        <ProjectSettings
          projectId={settingsProject.id}
          projectName={
            settingsProject.name ||
            projectNameFromPath(settingsProject.path)
          }
          projectPath={settingsProject.path}
          initialCommandTemplate={settingsProject.command_template}
          onClose={handleCloseSettings}
          onSaved={refresh}
        />
      )}
    </div>
  );
};

export default ProjectPicker;
