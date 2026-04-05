import { type FC, useState, useCallback } from "react";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (commandTemplate.trim() === "") return;

    setSaving(true);
    setError(null);
    try {
      await invoke("update_project_settings", {
        id: projectId,
        settings: { commandTemplate },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Project Settings
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">{projectName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <CommandTemplateInput
            value={commandTemplate}
            onChange={setCommandTemplate}
            projectDir={projectPath}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-800 px-5 py-3">
          {error && (
            <p className="mr-auto text-xs text-red-400">{error}</p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={commandTemplate.trim() === "" || saving}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettings;
