import type { CopyKey } from '../../copy/en';
import { chapterOffsets, type ChapterId, type ReplayBundle } from './bundle';

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Fixed jump size for the Left and Right keys. */
export const SEEK_STEP_MS = 5000;

export interface ChapterMarker {
  id: ChapterId;
  offsetMs: number;
  copyKey: CopyKey;
}

const ORDER: readonly ChapterId[] = ['reg', 'bid', 'confirm', 'hammer', 'settle'];

const COPY_KEYS: Readonly<Record<ChapterId, CopyKey>> = {
  reg: 'replay.chapter.reg',
  bid: 'replay.chapter.bid',
  confirm: 'replay.chapter.confirm',
  hammer: 'replay.chapter.hammer',
  settle: 'replay.chapter.settle',
};

/** Chapters the recording contains, in time order. */
export function chapterMarkers(bundle: ReplayBundle): ChapterMarker[] {
  const offsets = chapterOffsets(bundle);
  const out: ChapterMarker[] = [];
  for (const id of ORDER) {
    const offsetMs = offsets[id];
    if (offsetMs !== undefined) out.push({ id, offsetMs, copyKey: COPY_KEYS[id] });
  }
  return out.sort((a, b) => a.offsetMs - b.offsetMs);
}

export function clampOffset(ms: number, durationMs: number): number {
  return Math.min(Math.max(ms, 0), Math.max(durationMs, 0));
}

/** Offset of the first event strictly after `offsetMs`, or null at the end. */
export function nextEventOffset(eventOffsets: readonly number[], offsetMs: number): number | null {
  let best: number | null = null;
  for (const at of eventOffsets) {
    if (at > offsetMs && (best === null || at < best)) best = at;
  }
  return best;
}

/** Offset of the first chapter strictly after `offsetMs`, or null when none is left. */
export function nextChapterOffset(
  chapters: readonly ChapterMarker[],
  offsetMs: number,
): number | null {
  return nextEventOffset(
    chapters.map((c) => c.offsetMs),
    offsetMs,
  );
}
