import { useEffect } from 'react';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import {
  SEEK_STEP_MS,
  SPEEDS,
  clampOffset,
  nextEventOffset,
  type ChapterMarker,
  type Speed,
} from './Chapters';
import { followingMarker, previousMarker, type ScrubMarker } from './Scrub';
import { Scrubber } from './Scrubber';

export type ReplayView = 'console' | 'screen' | 'ladder';

const VIEWS: ReadonlyArray<{ id: ReplayView; label: () => string }> = [
  { id: 'console', label: () => t('demo.roleConsole') },
  { id: 'screen', label: () => t('demo.roleScreen') },
  { id: 'ladder', label: () => t('ladder.title') },
];

export interface ControlsProps {
  durationMs: number;
  offsetMs: number;
  playing: boolean;
  speed: Speed;
  view: ReplayView;
  chapters: readonly ChapterMarker[];
  /** Offsets of every event in the recording, for the step-to-next-event key. */
  eventOffsets: readonly number[];
  /** Bids and the hammer, drawn on the timeline. */
  markers?: readonly ScrubMarker[];
  onSeek: (offsetMs: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: Speed) => void;
  /** Changing the view never changes the offset. */
  onViewChange: (view: ReplayView) => void;
}

const NO_MARKERS: readonly ScrubMarker[] = [];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
}

/** Play, pause, speed, scrub bar with chapter markers, view toggle and keyboard shortcuts. */
export function Controls({
  durationMs,
  offsetMs,
  playing,
  speed,
  view,
  chapters,
  eventOffsets,
  markers = NO_MARKERS,
  onSeek,
  onPlayingChange,
  onSpeedChange,
  onViewChange,
}: ControlsProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        if (e.target instanceof HTMLButtonElement || isEditable(e.target)) return;
        e.preventDefault();
        onPlayingChange(!playing);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (isEditable(e.target)) return;
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -SEEK_STEP_MS : SEEK_STEP_MS;
        onSeek(clampOffset(offsetMs + delta, durationMs));
      } else if (e.key === '.') {
        if (isEditable(e.target)) return;
        e.preventDefault();
        const next = nextEventOffset(eventOffsets, offsetMs);
        if (next !== null) onSeek(clampOffset(next, durationMs));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [playing, offsetMs, durationMs, eventOffsets, onSeek, onPlayingChange]);

  const prev = previousMarker(markers, offsetMs);
  const next = followingMarker(markers, offsetMs);

  return (
    <div className="gv-replay-controls">
      <button type="button" aria-pressed={playing} onClick={() => onPlayingChange(!playing)}>
        <Icon name={playing ? 'pause' : 'play'} />
        {playing ? t('console.pause') : t('console.resume')}
      </button>
      <div role="group" aria-label={t('replay.speed', { x: speed })}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={s === speed} onClick={() => onSpeedChange(s)}>
            {t('replay.speed', { x: s })}
          </button>
        ))}
      </div>
      <button
        type="button"
        data-scrub="prev"
        disabled={prev === null}
        onClick={() => {
          if (prev !== null) onSeek(prev.offsetMs);
        }}
      >
        {t('replay.scrub.prev')}
      </button>
      <button
        type="button"
        data-scrub="next"
        disabled={next === null}
        onClick={() => {
          if (next !== null) onSeek(next.offsetMs);
        }}
      >
        {t('replay.scrub.next')}
      </button>
      <Scrubber
        durationMs={durationMs}
        offsetMs={offsetMs}
        playing={playing}
        markers={markers}
        onSeek={onSeek}
        onPlayingChange={onPlayingChange}
      />
      <ul className="gv-replay-controls__chapters">
        {chapters.map((c) => (
          <li key={c.id}>
            <button type="button" data-chapter={c.id} onClick={() => onSeek(c.offsetMs)}>
              {t(c.copyKey)}
            </button>
          </li>
        ))}
      </ul>
      <div role="group" aria-label={t('replay.readonly')}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            data-view={v.id}
            aria-pressed={v.id === view}
            onClick={() => onViewChange(v.id)}
          >
            {v.label()}
          </button>
        ))}
      </div>
    </div>
  );
}
