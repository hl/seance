import { useState, useEffect } from "react";

/**
 * Returns a `tick` counter that increments every minute.
 * Use as a re-render trigger for components that display elapsed time.
 * Only one interval per consumer — call once in a parent and pass `tick` down.
 *
 * Also bumps the tick when the page regains visibility, so the sidebar
 * catches up immediately after the window was in the background.
 */
export function useElapsedTime(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);

    const id = setInterval(bump, 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return tick;
}
