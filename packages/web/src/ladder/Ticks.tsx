import { useEffect, useRef, useState } from 'react';
import { Icon } from '../design/icons';
import type { LadderEvent } from './ladderModel';

export interface TicksProps {
  events: readonly LadderEvent[];
  /** Only ticks for this paddle are shown; omit to show every tick. */
  paddle?: number;
}

/** Drops repeated eventIds, keeping the first occurrence (R-WEB-089). */
export function uniqueEvents(events: readonly LadderEvent[]): LadderEvent[] {
  const seen = new Set<string>();
  const out: LadderEvent[] = [];
  for (const ev of events) {
    if (seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    out.push(ev);
  }
  return out;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One tick per verifiedBy entry, idempotent by eventId. A tick animates once, the first time
 * its eventId appears after mount; with reduced motion it is shown static.
 */
export function Ticks({ events, paddle }: TicksProps) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(events.map((e) => e.eventId));
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const reduced = prefersReducedMotion();

  const ticks = uniqueEvents(events).filter((e) => paddle === undefined || e.paddle === paddle);

  useEffect(() => {
    if (reduced) return;
    const ids = uniqueEvents(events)
      .map((e) => e.eventId)
      .filter((id) => !initial.current?.has(id) && !shown.has(id));
    if (ids.length === 0) return;
    const frame = requestAnimationFrame(() => {
      setShown((prev) => new Set([...prev, ...ids]));
    });
    return () => cancelAnimationFrame(frame);
  }, [events, reduced, shown]);

  return (
    <span className="gv-ladder__ticks">
      {ticks.map((ev) => {
        const animates = !reduced && !initial.current?.has(ev.eventId);
        const on = !animates || shown.has(ev.eventId);
        return (
          <span
            key={ev.eventId}
            className="gv-ladder__tick"
            data-event-id={ev.eventId}
            data-motion={animates ? 'animated' : 'static'}
            style={
              animates
                ? {
                    display: 'inline-flex',
                    opacity: on ? 1 : 0,
                    transform: on ? 'scale(1)' : 'scale(0.5)',
                    transition: 'opacity 200ms ease-out, transform 200ms ease-out',
                  }
                : { display: 'inline-flex' }
            }
          >
            <Icon name="check" />
          </span>
        );
      })}
    </span>
  );
}
