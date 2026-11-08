import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../ui/format';
import { STAGE_EVENTS, finalStage, initialStage, type StageState } from './judgeScript';

/** Wait before the stage plays by itself, so the page is read as a page first. */
export const AUTOPLAY_DELAY_MS = 1200;

export interface DemoScript {
  readonly state: StageState;
  readonly reduced: boolean;
  /** Starts the run from the top. Under reduced motion it lands on the final state at once. */
  readonly run: () => void;
}

/**
 * Plays the simulated run with timers. Reduced motion shows the finished run from the start, with
 * nothing moving, and a replay changes nothing but the narration. Timers die with the component.
 */
export function useDemoScript(autoplay: boolean = true): DemoScript {
  const [reduced] = useState(() => prefersReducedMotion());
  const [state, setState] = useState<StageState>(() => (reduced ? finalStage() : initialStage()));
  const timers = useRef<number[]>([]);

  const clear = useCallback((): void => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const run = useCallback((): void => {
    clear();
    if (reduced) {
      setState(finalStage());
      return;
    }
    setState(initialStage());
    for (const event of STAGE_EVENTS) {
      timers.current.push(window.setTimeout(() => setState((s) => event.apply(s)), event.at));
    }
  }, [clear, reduced]);

  useEffect(() => {
    if (!autoplay || reduced) return undefined;
    const id = window.setTimeout(run, AUTOPLAY_DELAY_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [autoplay, reduced, run]);

  useEffect(() => clear, [clear]);

  return { state, reduced, run };
}
