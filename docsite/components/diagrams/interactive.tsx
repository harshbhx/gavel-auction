'use client';

import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

// Shared interactivity for the diagrams. No animation runs by itself: every change is a user
// action (button, arrow key, hover or focus), so there is nothing to switch off for reduced motion.
// Usage in a diagram component:
//   const steps = useSteps(7);
//   <DiagramFrame toolbar={<StepControls steps={steps} labels={[...]} />} render={(p) => ... steps.index ...} />
// Mark SVG elements as dimmed when `steps.index < n` (use stepClass) so the diagram builds up.

export type Steps = { index: number; count: number; set: (n: number) => void; next: () => void; prev: () => void; reset: () => void };

export function useSteps(count: number, start = 0): Steps {
  const [index, setIndex] = useState(start);
  const set = useCallback((n: number) => setIndex(Math.max(0, Math.min(count - 1, n))), [count]);
  return {
    index,
    count,
    set,
    next: () => set(index + 1),
    prev: () => set(index - 1),
    reset: () => set(0),
  };
}

/** Opacity helper: elements that belong to a later step are faded, the current step is emphasised. */
export function stepStyle(steps: Steps, at: number): { opacity: number } {
  return { opacity: steps.index >= at ? 1 : 0.18 };
}

const btn =
  'inline-flex items-center gap-1 rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent disabled:opacity-40';

/** Previous / next / reset buttons, arrow-key support and a live text of the current step. */
export function StepControls({ steps, labels, title = 'Step' }: { steps: Steps; labels: ReactNode[]; title?: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      steps.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      steps.prev();
    } else if (e.key === 'Home') {
      e.preventDefault();
      steps.reset();
    }
  };
  return (
    <div onKeyDown={onKey} role="group" aria-label={`${title} through the diagram`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={steps.prev} disabled={steps.index === 0}>
          <ChevronLeft className="size-3.5" aria-hidden />
          Previous
        </button>
        <button type="button" className={btn} onClick={steps.next} disabled={steps.index === steps.count - 1}>
          Next
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={steps.reset} disabled={steps.index === 0}>
          <RotateCcw className="size-3.5" aria-hidden />
          Reset
        </button>
        <span className="font-mono text-[0.7rem] text-fd-muted-foreground">
          {title} {steps.index + 1} of {steps.count}. Arrow keys work too.
        </span>
      </div>
      <p className="mt-2 min-h-[3rem]" aria-live="polite">
        {labels[steps.index]}
      </p>
    </div>
  );
}

/** Hover / focus details: `hot.props(id)` goes on a <g> in the SVG, <DetailPanel> shows the text. */
export function useHot() {
  const [active, setActive] = useState<string | null>(null);
  return {
    active,
    props: (id: string) => ({
      tabIndex: 0,
      role: 'button' as const,
      'aria-label': id,
      onMouseEnter: () => setActive(id),
      onFocus: () => setActive(id),
      onClick: () => setActive(id),
      onMouseLeave: () => setActive(null),
      style: { cursor: 'pointer', outline: 'none' } as const,
    }),
  };
}

export function DetailPanel({
  active,
  details,
  hint = 'Hover or focus a box for what it does and which file implements it.',
}: {
  active: string | null;
  details: Record<string, ReactNode>;
  hint?: string;
}) {
  return (
    <p className="min-h-[3rem]" aria-live="polite">
      {active && details[active] ? details[active] : <span className="text-fd-muted-foreground">{hint}</span>}
    </p>
  );
}
