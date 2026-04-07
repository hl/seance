import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export type DiffResult =
  | { kind: "ok"; diff_text: string; changed_files: string[]; fallback_used: boolean }
  | { kind: "no_changes" }
  | { kind: "not_git_repo" }
  | { kind: "error"; message: string };

interface UseDiffReturn {
  diffResult: DiffResult | null;
  lastUpdated: number | null;
  isLoading: boolean;
}

const POLL_INTERVAL = 2000;
const MIN_FETCH_GAP = 500;

export function useDiff(sessionId: string, isActive: boolean): UseDiffReturn {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const notGitRepoRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const prevSessionIdRef = useRef(sessionId);

  // Reset the not-git-repo flag when sessionId changes
  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId;
    notGitRepoRef.current = false;
    setDiffResult(null);
    setLastUpdated(null);
  }

  const fetchDiff = useCallback(async () => {
    const now = Date.now();
    const elapsed = now - lastFetchTimeRef.current;
    if (elapsed < MIN_FETCH_GAP) return;

    setIsLoading(true);
    lastFetchTimeRef.current = Date.now();

    try {
      const result = await invoke<DiffResult>("get_session_diff", { sessionId });
      setDiffResult(result);
      setLastUpdated(Date.now());

      if (result.kind === "not_git_repo") {
        notGitRepoRef.current = true;
      }
    } catch {
      setDiffResult({ kind: "error", message: "Failed to fetch diff" });
      setLastUpdated(Date.now());
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!isActive || notGitRepoRef.current) return;

    // Fetch immediately on activation
    fetchDiff();

    const id = setInterval(() => {
      if (!notGitRepoRef.current) {
        fetchDiff();
      }
    }, POLL_INTERVAL);

    return () => clearInterval(id);
  }, [isActive, fetchDiff]);

  return { diffResult, lastUpdated, isLoading };
}
