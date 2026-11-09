import { useEffect, useState } from 'react';

/** Below this width the grids switch to one card per row, so nothing scrolls sideways. */
export const NARROW_MAX_PX = 700;

function query(q: string): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(q);
}

function useMedia(q: string, fallback: boolean): boolean {
  const [on, setOn] = useState(() => query(q)?.matches ?? fallback);
  useEffect(() => {
    const mq = query(q);
    if (mq === null) return undefined;
    const update = (): void => {
      setOn(mq.matches);
    };
    update();
    mq.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
    };
  }, [q]);
  return on;
}

/** True under 700px wide. An explicit value (tests, screenshots) wins over the media query. */
export function useNarrow(override?: boolean): boolean {
  const media = useMedia(`(max-width: ${NARROW_MAX_PX - 1}px)`, false);
  return override ?? media;
}

/** True when the visitor asked for less motion: the grids then skip flashes and row animation. */
export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)', false);
}
