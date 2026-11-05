import { useEffect, useRef, useState } from 'react';

export const ANNOUNCE_GAP_MS = 2000;

/**
 * Returns the text to place in an aria-live region: the first change shows at once, later
 * changes show at most once per `gapMs`, and the newest text wins (R-WEB-076).
 */
export function useThrottledAnnounce(message: string, gapMs: number = ANNOUNCE_GAP_MS): string {
  const [shown, setShown] = useState(message);
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(message);
  latest.current = message;

  useEffect(() => {
    if (message === shown || timer.current !== null) return;
    const wait = lastAt.current + gapMs - Date.now();
    const emit = (): void => {
      timer.current = null;
      lastAt.current = Date.now();
      setShown(latest.current);
    };
    if (wait <= 0) emit();
    else timer.current = setTimeout(emit, wait);
  }, [message, shown, gapMs]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return shown;
}
