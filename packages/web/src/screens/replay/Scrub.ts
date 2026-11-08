import type { ReplayBundle } from './bundle';
import { clampOffset } from './Chapters';

/** A point on the scrub track: a bid that raised the price, or the hammer. */
export interface ScrubMarker {
  id: string;
  kind: 'bid' | 'hammer';
  offsetMs: number;
  /** Price in cents after the bid or at the hammer. */
  cents: number;
}

/** Every bid that raised the price and the hammer, in time order. */
export function scrubMarkers(bundle: ReplayBundle): ScrubMarker[] {
  const out: ScrubMarker[] = [];
  let top = 0;
  bundle.events.forEach(({ t, msg }, index) => {
    if (msg.t === 'price' && msg.leaderId !== null && msg.price > top) {
      top = msg.price;
      out.push({ id: `bid-${index}`, kind: 'bid', offsetMs: t, cents: msg.price });
    } else if (msg.t === 'hammer') {
      out.push({ id: `hammer-${index}`, kind: 'hammer', offsetMs: t, cents: msg.price });
    }
  });
  return out;
}

/** Position of an offset on the track, 0 to 100. A zero-length recording sits at 0. */
export function offsetToPercent(offsetMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (clampOffset(offsetMs, durationMs) / durationMs) * 100;
}

/** Offset under a pointer: `fraction` is 0 at the left end of the track and 1 at the right end. */
export function fractionToOffset(fraction: number, durationMs: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return clampOffset(Math.round(Math.min(Math.max(fraction, 0), 1) * durationMs), durationMs);
}

/** Last marker strictly before `offsetMs`, or null. A 250 ms margin makes "previous" leave a marker you stand on. */
export function previousMarker(
  markers: readonly ScrubMarker[],
  offsetMs: number,
): ScrubMarker | null {
  let best: ScrubMarker | null = null;
  for (const m of markers) {
    if (m.offsetMs < offsetMs - 250 && (best === null || m.offsetMs > best.offsetMs)) best = m;
  }
  return best;
}

/** First marker strictly after `offsetMs`, or null. */
export function followingMarker(
  markers: readonly ScrubMarker[],
  offsetMs: number,
): ScrubMarker | null {
  let best: ScrubMarker | null = null;
  for (const m of markers) {
    if (m.offsetMs > offsetMs && (best === null || m.offsetMs < best.offsetMs)) best = m;
  }
  return best;
}

/** Scrub gesture: the replay pauses while the handle is held and goes back to what it was on release. */
export interface ScrubState {
  dragging: boolean;
  /** Whether the replay was playing when the drag began. */
  resumeAfter: boolean;
}

export const SCRUB_IDLE: ScrubState = { dragging: false, resumeAfter: false };

export type ScrubAction = { kind: 'down'; playing: boolean } | { kind: 'up' };

export interface ScrubStep {
  state: ScrubState;
  /** What the player should do with play/pause as a result, or null to leave it. */
  setPlaying: boolean | null;
}

/** Pure state machine for the drag. A second `down` without an `up` keeps the first resume decision. */
export function scrubReduce(state: ScrubState, action: ScrubAction): ScrubStep {
  if (action.kind === 'down') {
    if (state.dragging) return { state, setPlaying: null };
    return {
      state: { dragging: true, resumeAfter: action.playing },
      setPlaying: action.playing ? false : null,
    };
  }
  if (!state.dragging) return { state, setPlaying: null };
  return { state: SCRUB_IDLE, setPlaying: state.resumeAfter ? true : null };
}

/** Spoken value for the slider, such as "1:05 of 2:30". */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(ms, 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
