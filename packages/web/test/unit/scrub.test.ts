import { describe, expect, it } from 'vitest';
import { parseBundle } from '../../src/screens/replay/bundle';
import {
  SCRUB_IDLE,
  followingMarker,
  formatClock,
  fractionToOffset,
  offsetToPercent,
  previousMarker,
  scrubMarkers,
  scrubReduce,
} from '../../src/screens/replay/Scrub';
import { happy } from '../../src/testing/scenarios/happy';

const raw = {
  version: 1,
  title: 'Spring Gala demo',
  events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
};

function bundle() {
  const r = parseBundle(raw);
  if (!r.ok) throw new Error('bundle');
  return r.bundle;
}

describe('scrubMarkers', () => {
  it('lists every price-raising bid and the hammer in time order', () => {
    const marks = scrubMarkers(bundle());
    expect(marks.filter((m) => m.kind === 'bid').map((m) => m.cents)).toEqual([
      5_000, 15_000, 25_000, 30_000, 35_000,
    ]);
    const last = marks[marks.length - 1];
    expect(last?.kind).toBe('hammer');
    expect(last?.offsetMs).toBe(15_000);
    const offsets = marks.map((m) => m.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe('track maths', () => {
  it('maps offsets and fractions both ways and clamps', () => {
    expect(offsetToPercent(5_000, 20_000)).toBe(25);
    expect(offsetToPercent(99_000, 20_000)).toBe(100);
    expect(offsetToPercent(5, 0)).toBe(0);
    expect(fractionToOffset(0.5, 20_000)).toBe(10_000);
    expect(fractionToOffset(-1, 20_000)).toBe(0);
    expect(fractionToOffset(7, 20_000)).toBe(20_000);
    expect(fractionToOffset(Number.NaN, 20_000)).toBe(0);
  });

  it('finds the previous and following marker', () => {
    const marks = scrubMarkers(bundle());
    expect(followingMarker(marks, 0)?.offsetMs).toBe(1_000);
    expect(followingMarker(marks, 1_000)?.offsetMs).toBe(2_000);
    expect(followingMarker(marks, 15_000)).toBeNull();
    expect(previousMarker(marks, 1_000)).toBeNull();
    expect(previousMarker(marks, 3_100)?.offsetMs).toBe(2_000);
    expect(previousMarker(marks, 3_500)?.offsetMs).toBe(3_000);
  });

  it('formats a clock', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('scrubReduce', () => {
  it('pauses a playing replay on grab and resumes on release', () => {
    const down = scrubReduce(SCRUB_IDLE, { kind: 'down', playing: true });
    expect(down.setPlaying).toBe(false);
    expect(down.state.dragging).toBe(true);
    const up = scrubReduce(down.state, { kind: 'up' });
    expect(up.setPlaying).toBe(true);
    expect(up.state).toEqual(SCRUB_IDLE);
  });

  it('leaves a paused replay paused', () => {
    const down = scrubReduce(SCRUB_IDLE, { kind: 'down', playing: false });
    expect(down.setPlaying).toBeNull();
    expect(scrubReduce(down.state, { kind: 'up' }).setPlaying).toBeNull();
  });

  it('keeps the first resume decision on a repeated grab and ignores a stray release', () => {
    const first = scrubReduce(SCRUB_IDLE, { kind: 'down', playing: true });
    const again = scrubReduce(first.state, { kind: 'down', playing: false });
    expect(again.setPlaying).toBeNull();
    expect(again.state.resumeAfter).toBe(true);
    expect(scrubReduce(SCRUB_IDLE, { kind: 'up' }).setPlaying).toBeNull();
  });
});
