import { useEffect, useRef } from 'react';
import { useInView, useReducedMotion } from './hooks';

/** Rounded ease-out count, in the style of the Magic UI Number Ticker. Original code. */
export function countAt(target: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round(target * (1 - (1 - p) ** 3));
}

/**
 * Shows the final number in the markup. When the figure scrolls into view and motion is allowed it
 * counts up from zero once; under reduced motion the final number is all there is. The width is
 * reserved by the final digits, so the count never moves the layout.
 */
export function NumberTicker({
  value,
  durationMs = 1400,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLSpanElement>();
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null || reduced || !seen || done.current) return undefined;
    if (typeof requestAnimationFrame !== 'function') return undefined;
    // Without IntersectionObserver there is no moment of "scrolled into view": keep the number.
    if (typeof IntersectionObserver === 'undefined') return undefined;
    done.current = true;
    let frame = 0;
    const start = performance.now();
    const step = (now: number): void => {
      const p = (now - start) / durationMs;
      el.textContent = String(countAt(value, p));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    el.textContent = '0';
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = String(value);
      done.current = false;
    };
  }, [reduced, seen, value, durationMs, ref]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </span>
  );
}
