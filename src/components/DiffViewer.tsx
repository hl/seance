import { type FC, useState, useEffect, useRef } from "react";
import { html } from "diff2html";
import DOMPurify from "dompurify";
import "diff2html/bundles/css/diff2html.min.css";
import { useDiff } from "../hooks/useDiff";

interface DiffViewerProps {
  sessionId: string;
  isActive: boolean;
}

function TimeAgo({ lastUpdated }: { lastUpdated: number | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (lastUpdated === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  if (lastUpdated === null) return null;

  const seconds = Math.max(0, Math.round((now - lastUpdated) / 1000));
  return (
    <span className="whitespace-nowrap text-xs text-text-muted">
      Last updated: {seconds}s ago
    </span>
  );
}

const DiffViewer: FC<DiffViewerProps> = ({ sessionId, isActive }) => {
  const { diffResult, lastUpdated, isLoading } = useDiff(sessionId, isActive);
  const [activeFile, setActiveFile] = useState<number | null>(null);
  const diffBodyRef = useRef<HTMLDivElement>(null);

  // Reset active file when session changes
  useEffect(() => {
    setActiveFile(null);
  }, [sessionId]);

  const handleFileClick = (index: number) => {
    setActiveFile(index);
    const el = diffBodyRef.current?.querySelector(`[id="d2h-file-${index}"]`)
      ?? diffBodyRef.current?.querySelectorAll(".d2h-file-wrapper")?.[index];
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Loading state
  if (diffResult === null && isLoading) {
    return (
      <div className="flex h-full flex-col bg-bg">
        <div className="flex items-center border-b border-border bg-bg-secondary px-3 py-2">
          <div className="h-4 w-48 animate-pulse rounded bg-surface" />
          <div className="ml-auto h-4 w-24 animate-pulse rounded bg-surface" />
        </div>
        <div className="flex-1 p-4">
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-surface" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface" />
          </div>
        </div>
      </div>
    );
  }

  // Empty/error states
  if (diffResult !== null && diffResult.kind !== "ok") {
    let message: string;
    switch (diffResult.kind) {
      case "not_git_repo":
        message = "Not a git repository";
        break;
      case "no_changes":
        message = "No changes since session start";
        break;
      case "error":
        message = `Diff unavailable: ${diffResult.message}`;
        break;
    }

    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <p className="text-sm text-text-muted">{message}</p>
      </div>
    );
  }

  // No result yet and not loading
  if (diffResult === null) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <p className="text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  // diffResult.kind === "ok"
  const { diff_text, changed_files, fallback_used } = diffResult;
  const rawHtml = html(diff_text, {
    drawFileList: false,
    outputFormat: "line-by-line",
  });
  const safeHtml = DOMPurify.sanitize(rawHtml);

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Header: file list + last updated */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3 py-1.5">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {changed_files.map((file, i) => (
            <button
              key={file}
              onClick={() => handleFileClick(i)}
              className={`shrink-0 rounded px-2 py-0.5 text-xs transition-colors ${
                activeFile === i
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              {file}
            </button>
          ))}
        </div>
        <TimeAgo lastUpdated={lastUpdated} />
      </div>

      {/* Fallback notice */}
      {fallback_used && (
        <div className="shrink-0 border-b border-border bg-accent-secondary/10 px-3 py-1.5 text-xs text-accent-secondary">
          Showing uncommitted changes only — baseline commit is no longer reachable
        </div>
      )}

      {/* Diff body */}
      <div
        ref={diffBodyRef}
        className="diff2html-wrapper flex-1 overflow-auto"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
};

export default DiffViewer;
