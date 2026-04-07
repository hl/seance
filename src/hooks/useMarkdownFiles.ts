import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const POLL_INTERVAL = 2000;
const MIN_FETCH_GAP = 500;

export interface UseMarkdownFilesResult {
  files: string[];
  selectedFile: string | null;
  setSelectedFile: (file: string | null) => void;
  content: string;
  isLoading: boolean;
  fileDeleted: boolean;
}

export function useMarkdownFiles(
  sessionId: string,
  isActive: boolean,
): UseMarkdownFilesResult {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [fileDeleted, setFileDeleted] = useState(false);

  const lastFetchRef = useRef(0);

  // Poll file list
  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    const fetchFiles = async () => {
      const now = Date.now();
      const elapsed = now - lastFetchRef.current;
      if (elapsed < MIN_FETCH_GAP) return;

      try {
        lastFetchRef.current = Date.now();
        const result = await invoke<string[]>("list_markdown_files", {
          sessionId,
        });
        if (!cancelled) {
          setFiles(result);
        }
      } catch {
        // Silently ignore poll errors
      }
    };

    // Initial fetch
    fetchFiles();

    const id = setInterval(fetchFiles, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, isActive]);

  // Detect file deletion
  useEffect(() => {
    if (selectedFile && files.length > 0 && !files.includes(selectedFile)) {
      setFileDeleted(true);
    }
  }, [files, selectedFile]);

  // Clear fileDeleted when selection changes
  const handleSetSelectedFile = useCallback((file: string | null) => {
    setFileDeleted(false);
    setSelectedFile(file);
  }, []);

  // Fetch content when selectedFile changes
  useEffect(() => {
    if (!selectedFile || fileDeleted) {
      setContent("");
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    invoke<string>("read_markdown_file", {
      sessionId,
      relativePath: selectedFile,
    })
      .then((result) => {
        if (!cancelled) {
          setContent(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, selectedFile, fileDeleted]);

  return {
    files,
    selectedFile,
    setSelectedFile: handleSetSelectedFile,
    content,
    isLoading,
    fileDeleted,
  };
}
