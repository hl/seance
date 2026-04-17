import { type FC, useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import CommandTemplateInput from "./CommandTemplateInput";

interface ProjectSettingsProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  initialCommandTemplate?: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface ProjectData {
  id: string;
  command_template: string;
  path: string;
}

const ProjectSettings: FC<ProjectSettingsProps> = ({
  projectId,
  projectName,
  projectPath,
  initialCommandTemplate = "",
  onClose,
  onSaved,
}) => {
  const [commandTemplate, setCommandTemplate] = useState(
    initialCommandTemplate,
  );
  const [loading, setLoading] = useState(!initialCommandTemplate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the current command template from the backend on mount
  useEffect(() => {
    if (initialCommandTemplate) return; // Already provided by caller

    let cancelled = false;
    (async () => {
      try {
        const projects = await invoke<ProjectData[]>("list_projects");
        const project = projects.find((p) => p.id === projectId);
        if (!cancelled && project) {
          setCommandTemplate(project.command_template);
        }
      } catch {
        // Use empty default
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, initialCommandTemplate]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("update_project_settings", {
        id: projectId,
        settings: { command_template: commandTemplate },
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [projectId, commandTemplate, onClose, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="project-settings-title">
      <div className="mx-4 w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="project-settings-title" className="text-base font-semibold text-text">
              Project Settings
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{projectName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-text-muted transition-colors hover:bg-interactive-hover hover:text-text-secondary-hover"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {loading ? (
            <p className="py-4 text-center text-sm text-text-muted">Loading...</p>
          ) : (
            <CommandTemplateInput
              value={commandTemplate}
              onChange={setCommandTemplate}
              projectDir={projectPath}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {error && (
            <p className="mr-auto text-xs text-red-700 dark:text-red-400">{error}</p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-interactive-hover hover:text-text-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-btn-primary-bg px-4 py-2 text-sm font-medium text-btn-primary-text transition-colors hover:bg-btn-primary-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettings;
