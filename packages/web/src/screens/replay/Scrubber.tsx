import { useRef, type ChangeEvent } from 'react';
import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import { clampOffset } from './Chapters';
import {
  SCRUB_IDLE,
  formatClock,
  offsetToPercent,
  scrubReduce,
  type ScrubMarker,
  type ScrubState,
} from './Scrub';
import './replay.css';

export interface ScrubberProps {
  durationMs: number;
  offsetMs: number;
  playing: boolean;
  markers: readonly ScrubMarker[];
  onSeek: (offsetMs: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

/**
 * Timeline over the whole recording. A native range input carries the drag and the keyboard
 * (arrows, Home, End, Page keys), so it needs no custom focus handling. Bid and hammer marks sit
 * on the track and jump to their moment. The replay holds still while the handle is held.
 */
export function Scrubber({
  durationMs,
  offsetMs,
  playing,
  markers,
  onSeek,
  onPlayingChange,
}: ScrubberProps) {
  const gesture = useRef<ScrubState>(SCRUB_IDLE);

  const send = (action: Parameters<typeof scrubReduce>[1]): void => {
    const step = scrubReduce(gesture.current, action);
    gesture.current = step.state;
    if (step.setPlaying !== null) onPlayingChange(step.setPlaying);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onSeek(clampOffset(Number(e.target.value), durationMs));
  };

  const at = clampOffset(offsetMs, durationMs);
  return (
    <div className="gv-scrub">
      <input
        className="gv-scrub__range"
        type="range"
        min={0}
        max={durationMs}
        step={100}
        value={at}
        onChange={onChange}
        onPointerDown={() => {
          send({ kind: 'down', playing });
        }}
        onPointerUp={() => {
          send({ kind: 'up' });
        }}
        onPointerCancel={() => {
          send({ kind: 'up' });
        }}
        onBlur={() => {
          send({ kind: 'up' });
        }}
        aria-label={t('replay.scrub.label')}
        aria-valuetext={t('replay.scrub.value', {
          at: formatClock(at),
          total: formatClock(durationMs),
        })}
      />
      <ol className="gv-scrub__marks">
        {markers.map((m) => {
          const label =
            m.kind === 'hammer'
              ? t('replay.scrub.hammer', {
                  amount: formatUsd(m.cents),
                  at: formatClock(m.offsetMs),
                })
              : t('replay.scrub.bid', { amount: formatUsd(m.cents), at: formatClock(m.offsetMs) });
          return (
            <li
              key={m.id}
              className="gv-scrub__mark"
              data-kind={m.kind}
              style={{ left: `${offsetToPercent(m.offsetMs, durationMs)}%` }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={label}
                title={label}
                onClick={() => {
                  onSeek(m.offsetMs);
                }}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
