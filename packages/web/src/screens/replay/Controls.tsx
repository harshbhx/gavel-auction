import { useEffect, type ChangeEvent } from 'react';
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
  onSeek: (offsetMs: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: Speed) => void;
  /** Changing the view never changes the offset. */
  onViewChange: (view: ReplayView) => void;
}

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

  const onScrub = (e: ChangeEvent<HTMLInputElement>): void => {
    onSeek(clampOffset(Number(e.target.value), durationMs));
  };

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
      <input
        type="range"
        min={0}
        max={durationMs}
        step={100}
        value={clampOffset(offsetMs, durationMs)}
        onChange={onScrub}
        aria-label={t('replay.readonly')}
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
