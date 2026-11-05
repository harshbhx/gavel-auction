import { t } from '../copy/t';
import type { LadderEvent } from './ladderModel';
import { uniqueEvents } from './Ticks';

export interface EventLogProps {
  events: readonly LadderEvent[];
}

function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

function lineText(ev: LadderEvent): string {
  return ev.kind === 'webhook'
    ? t('ladder.verify.webhook', { type: ev.eventType ?? '', time: clock(ev.at) })
    : t('ladder.verify.lookup', { time: clock(ev.at) });
}

/** Ladder event log: one line per confirmation, one per eventId, oldest first (R-WEB-089). */
export function EventLog({ events }: EventLogProps) {
  const lines = uniqueEvents(events);
  if (lines.length === 0) return null;
  return (
    <ol className="gv-ladder__log" aria-label={t('ladder.title')}>
      {lines.map((ev) => (
        <li key={ev.eventId} data-event-id={ev.eventId} data-paddle={ev.paddle}>
          <span className="tabular">{ev.paddle}</span> {lineText(ev)}
        </li>
      ))}
    </ol>
  );
}
