import { type FC, useMemo } from "react";

interface CommandTemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  projectDir?: string;
}

const SAMPLE_VALUES: Record<string, string> = {
  "{{session_name}}": "Maya",
  "{{task}}": "example-task",
  "{{project_dir}}": "/path/to/project",
};

function resolveTemplate(
  template: string,
  projectDir: string | undefined,
): string {
  let resolved = template;
  for (const [placeholder, sample] of Object.entries(SAMPLE_VALUES)) {
    const value =
      placeholder === "{{project_dir}}" && projectDir
        ? projectDir
        : sample;
    resolved = resolved.replaceAll(placeholder, value);
  }
  return resolved;
}

const CommandTemplateInput: FC<CommandTemplateInputProps> = ({
  value,
  onChange,
  projectDir,
}) => {
  const preview = useMemo(
    () => resolveTemplate(value, projectDir),
    [value, projectDir],
  );

  const isEmpty = value.trim() === "";

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="command-template"
          className="mb-1 block text-sm font-medium text-text-secondary"
        >
          Command Template
        </label>
        <input
          id="command-template"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. claude --name {{session_name}} --task {{task}}"
          className={`w-full rounded-md border bg-surface px-3 py-2 font-mono text-sm text-text placeholder-text-placeholder focus:outline-none focus:ring-1 ${
            isEmpty
              ? "border-red-500/50 focus:ring-red-500/50"
              : "border-border-input focus:ring-ring-focus"
          }`}
        />
        {isEmpty && (
          <p className="mt-1 text-xs text-red-700 dark:text-red-400">
            Command template cannot be empty
          </p>
        )}
      </div>

      <div className="text-xs text-text-muted">
        <p className="mb-1 font-medium text-text-secondary">
          Available placeholders:
        </p>
        <ul className="ml-2 space-y-0.5">
          <li>
            <code className="text-text-secondary">{"{{session_name}}"}</code> — the
            generated session name
          </li>
          <li>
            <code className="text-text-secondary">{"{{task}}"}</code> — the
            user-assigned task label
          </li>
          <li>
            <code className="text-text-secondary">{"{{project_dir}}"}</code> — the
            absolute path of the project directory
          </li>
        </ul>
      </div>

      {value.trim() !== "" && (
        <div>
          <p className="mb-1 text-xs font-medium text-text-secondary">Preview:</p>
          <div className="rounded-md bg-surface-subtle px-3 py-2 font-mono text-xs text-text-secondary">
            {preview}
          </div>
        </div>
      )}
    </div>
  );
};

export default CommandTemplateInput;
