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
          className="mb-1 block text-sm font-medium text-neutral-300"
        >
          Command Template
        </label>
        <input
          id="command-template"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. claude --name {{session_name}} --task {{task}}"
          className={`w-full rounded-md border bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-1 ${
            isEmpty
              ? "border-red-500/50 focus:ring-red-500/50"
              : "border-neutral-700 focus:ring-neutral-500"
          }`}
        />
        {isEmpty && (
          <p className="mt-1 text-xs text-red-400">
            Command template cannot be empty
          </p>
        )}
      </div>

      <div className="text-xs text-neutral-500">
        <p className="mb-1 font-medium text-neutral-400">
          Available placeholders:
        </p>
        <ul className="ml-2 space-y-0.5">
          <li>
            <code className="text-neutral-400">{"{{session_name}}"}</code> — the
            generated session name
          </li>
          <li>
            <code className="text-neutral-400">{"{{task}}"}</code> — the
            user-assigned task label
          </li>
          <li>
            <code className="text-neutral-400">{"{{project_dir}}"}</code> — the
            absolute path of the project directory
          </li>
        </ul>
      </div>

      {value.trim() !== "" && (
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-400">Preview:</p>
          <div className="rounded-md bg-neutral-800/50 px-3 py-2 font-mono text-xs text-neutral-300">
            {preview}
          </div>
        </div>
      )}
    </div>
  );
};

export default CommandTemplateInput;
