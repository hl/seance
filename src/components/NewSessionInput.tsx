import { type FC, useState, useCallback, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";

interface NewSessionInputProps {
  projectId: string;
  onDone: () => void;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

const NewSessionInput: FC<NewSessionInputProps> = ({ projectId, onDone }) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createSession = useSessionStore((s) => s.createSession);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Task name is required");
      return;
    }
    if (!isValidSlug(trimmed)) {
      setError("Use lowercase letters, digits, and hyphens only");
      return;
    }
    try {
      await createSession(projectId, trimmed);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [value, projectId, createSession, onDone]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDone();
      }
    },
    [handleSubmit, onDone],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      setError(null);
    },
    [],
  );

  return (
    <div className="px-3 py-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="task-name"
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
        aria-label="New session task name"
        data-testid="new-session-input"
      />
      {error && (
        <p className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default NewSessionInput;

export { isValidSlug };
