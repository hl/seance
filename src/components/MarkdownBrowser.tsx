import { type FC, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import "highlight.js/styles/github-dark.css";
import { useMarkdownFiles } from "../hooks/useMarkdownFiles";

interface MarkdownBrowserProps {
  sessionId: string;
  isActive: boolean;
}

const MarkdownBrowser: FC<MarkdownBrowserProps> = ({
  sessionId,
  isActive,
}) => {
  const {
    files,
    selectedFile,
    setSelectedFile,
    content,
    isLoading,
    fileDeleted,
  } = useMarkdownFiles(sessionId, isActive);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [files],
  );

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div
        className={`flex shrink-0 flex-col border-r border-border bg-bg-secondary transition-[width] duration-150 ${
          sidebarOpen ? "w-1/4 min-w-48" : "w-8"
        }`}
      >
        {/* Sidebar header with toggle */}
        <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-0.5 text-text-muted transition-colors hover:text-text"
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg
              className={`h-4 w-4 transition-transform duration-150 ${sidebarOpen ? "" : "rotate-180"}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {sidebarOpen && (
            <span className="ml-1.5 text-xs font-medium text-text-secondary">
              Files
            </span>
          )}
        </div>

        {/* File list */}
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto py-1">
            {sortedFiles.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-muted">
                No markdown files found
              </p>
            ) : (
              sortedFiles.map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => setSelectedFile(file)}
                  className={`block w-full truncate px-3 py-1 text-left text-xs transition-colors ${
                    file === selectedFile
                      ? "bg-accent/15 text-accent"
                      : "text-text-muted hover:bg-bg-hover hover:text-text"
                  }`}
                  title={file}
                >
                  {file}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Preview panel */}
      <div className="flex-1 overflow-auto bg-bg p-6">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-3/4 rounded bg-border" />
            <div className="h-4 w-1/2 rounded bg-border" />
            <div className="h-4 w-5/6 rounded bg-border" />
          </div>
        ) : fileDeleted ? (
          <p className="text-sm text-text-muted">
            File no longer exists: {selectedFile}
          </p>
        ) : !selectedFile ? (
          <p className="text-sm text-text-muted">Select a file to preview</p>
        ) : (
          <article className="prose prose-sm dark:prose-invert max-w-none text-text prose-headings:text-text prose-a:text-accent prose-strong:text-text prose-code:text-text-secondary prose-pre:bg-surface prose-pre:border prose-pre:border-border">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, rehypeSanitize]}
            >
              {content}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
};

export default MarkdownBrowser;
