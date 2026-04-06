import { type FC, useState, useCallback, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";

interface NewSessionInputProps {
  projectId: string;
  onDone: () => void;
}

/** Convert any text to a valid slug: lowercase, hyphens, no special chars. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric runs with hyphens
    .replace(/^-+|-+$/g, ""); // Trim leading/trailing hyphens
}

/** Make a slug unique within existing sessions for this project. */
function uniqueSlug(
  base: string,
  projectId: string,
  sessions: Map<string, { projectId: string; task: string }>,
): string {
  const existing = new Set(
    Array.from(sessions.values())
      .filter((s) => s.projectId === projectId)
      .map((s) => s.task),
  );

  if (!existing.has(base)) return base;

  let counter = 2;
  while (existing.has(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
}

const NewSessionInput: FC<NewSessionInputProps> = ({ projectId, onDone }) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createSession = useSessionStore((s) => s.createSession);
  const sessions = useSessionStore((s) => s.sessions);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (creating) return; // Prevent double-submit

    const trimmed = value.trim();
    if (!trimmed) {
      setError("Task name is required");
      return;
    }

    // Auto-slugify whatever the user typed
    const slug = slugify(trimmed);
    if (!slug) {
      setError("Task name must contain at least one letter or digit");
      return;
    }

    // Auto-deduplicate within project
    const finalSlug = uniqueSlug(slug, projectId, sessions);

    setCreating(true);
    setError(null);
    try {
      await createSession(projectId, finalSlug);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }, [value, projectId, createSession, onDone, creating, sessions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (!creating) onDone();
      }
    },
    [handleSubmit, onDone, creating],
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
      {creating ? (
        <div className="flex items-center gap-2 py-1">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-text-disabled border-t-text-secondary" />
          <span className="text-xs text-text-muted">
            Creating session...
          </span>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="task name (e.g. fix auth bug)"
            disabled={creating}
            className="w-full rounded border border-border-input bg-surface px-2 py-1 text-sm text-text placeholder-text-placeholder outline-none focus:border-border-focus disabled:opacity-50"
            aria-label="New session task name"
            data-testid="new-session-input"
          />
          {error && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default NewSessionInput;

export { slugify, uniqueSlug };
