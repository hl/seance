import { useState, useEffect } from "react";

/**
 * Returns a `tick` counter that increments every second.
 * Use as a re-render trigger for components that display elapsed time.
 * Only one interval per consumer — call once in a parent and pass `tick` down.
 */
export function useElapsedTime(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return tick;
}
