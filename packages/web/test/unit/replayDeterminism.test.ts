import { describe, expect, it } from 'vitest';
import { initialRoomState, reduce, type RoomState } from '../../src/store/roomReducer';
import { chapterOffsets, parseBundle, type ChapterId } from '../../src/screens/replay/bundle';
import { happy } from '../../src/testing/scenarios/happy';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function loadBundle() {
  const r = parseBundle({
    version: 1,
    title: 'Spring Gala demo',
    events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
  });
  if (!r.ok) throw new Error('fixture bundle rejected');
  return deepFreeze(r.bundle);
}

/** Scrub: rebuild the state from nothing up to and including offset t. */
function stateAt(bundle: ReturnType<typeof loadBundle>, t: number): RoomState {
  let state = deepFreeze(initialRoomState('auction-1'));
  for (const e of bundle.events) {
    if (e.t > t) break;
    state = deepFreeze(reduce(state, { kind: 'wire', msg: e.msg }).state);
  }
  return state;
}

describe('replay determinism (R-WEB-104)', () => {
  it('yields byte-identical state for the same bundle and offset, without touching frozen inputs', () => {
    const bundle = loadBundle();
    const t = bundle.durationMs;
    const a = stateAt(bundle, t);
    const b = stateAt(bundle, t);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reduce is pure: the same input twice gives equal output and no mutation', () => {
    const bundle = loadBundle();
    const first = bundle.events[0];
    if (first === undefined) throw new Error('fixture too short');
    const start = deepFreeze(initialRoomState('auction-1'));
    const before = JSON.stringify(start);
    const one = reduce(start, { kind: 'wire', msg: first.msg });
    const two = reduce(start, { kind: 'wire', msg: first.msg });
    expect(one).toEqual(two);
    expect(JSON.stringify(start)).toBe(before);
  });

  it('scrubbing to the hammer chapter equals the live reducer state at the same offset', () => {
    const bundle = loadBundle();
    const id: ChapterId = 'hammer';
    const hammerAt = chapterOffsets(bundle)[id];
    if (hammerAt === undefined) throw new Error('fixture has no hammer');

    // Live: events applied one by one, as playback delivers them.
    let live = deepFreeze(initialRoomState('auction-1'));
    for (const e of bundle.events) {
      if (e.t > hammerAt) break;
      live = deepFreeze(reduce(live, { kind: 'wire', msg: e.msg }).state);
    }

    const scrubbed = stateAt(bundle, hammerAt);
    expect(scrubbed).toEqual(live);
    expect(JSON.stringify(scrubbed)).toBe(JSON.stringify(live));
  });

  it('scrubbing backwards and forwards again lands on the same state', () => {
    const bundle = loadBundle();
    const mid = Math.floor(bundle.durationMs / 2);
    const first = stateAt(bundle, mid);
    stateAt(bundle, 0);
    stateAt(bundle, bundle.durationMs);
    expect(stateAt(bundle, mid)).toEqual(first);
  });
});
