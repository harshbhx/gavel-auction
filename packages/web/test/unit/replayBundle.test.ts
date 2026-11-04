import { describe, expect, it } from 'vitest';
import { bundleToScenario, chapterOffsets, parseBundle } from '../../src/screens/replay/bundle';
import { happy } from '../../src/testing/scenarios/happy';

function happyBundle(): unknown {
  return {
    version: 1,
    title: 'Spring Gala demo',
    events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
  };
}

describe('parseBundle', () => {
  it('accepts a valid bundle and derives duration and config', () => {
    const r = parseBundle(happyBundle());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.title).toBe('Spring Gala demo');
    expect(r.bundle.durationMs).toBe(18_000);
    expect(r.bundle.roomConfig.minIncrement).toBe(5_000);
  });

  it('falls back to a default title when none is given', () => {
    const raw = happyBundle() as Record<string, unknown>;
    delete raw['title'];
    const r = parseBundle(raw);
    expect(r.ok && r.bundle.title).toBe('Recording');
  });

  it.each([
    ['null', null, 'not_object'],
    ['an array', [], 'not_object'],
    ['wrong version', { version: 2, events: [] }, 'version'],
    ['no events', { version: 1, events: [] }, 'events'],
  ])('rejects %s', (_label, raw, error) => {
    expect(parseBundle(raw)).toEqual({ ok: false, error });
  });

  it('rejects a malformed message and reports its index', () => {
    const raw = happyBundle() as { events: Array<{ t: number; msg: unknown }> };
    raw.events[2] = { t: 5, msg: { v: 1, t: 'price', seq: 3 } };
    expect(parseBundle(raw)).toEqual({ ok: false, error: 'event', index: 2 });
  });

  it('rejects events out of time order', () => {
    const raw = happyBundle() as { events: Array<{ t: number; msg: unknown }> };
    const second = raw.events[1];
    if (second === undefined) throw new Error('fixture too short');
    raw.events[1] = { ...second, t: -1 };
    expect(parseBundle(raw)).toMatchObject({ ok: false, error: 'event' });
    raw.events[1] = { ...second, t: 9_999_999 };
    expect(parseBundle(raw)).toMatchObject({ ok: false, error: 'order' });
  });

  it('requires a state snapshot', () => {
    const raw = happyBundle() as { events: Array<{ t: number; msg: { t: string } }> };
    raw.events = raw.events.filter((e) => e.msg.t !== 'state');
    expect(parseBundle(raw)).toEqual({ ok: false, error: 'no_state' });
  });
});

describe('bundle helpers', () => {
  it('turns events into scenario steps at their recorded offsets', () => {
    const r = parseBundle(happyBundle());
    if (!r.ok) throw new Error('bundle should parse');
    const scenario = bundleToScenario(r.bundle);
    expect(scenario.steps.map((s) => s.at)).toEqual(r.bundle.events.map((e) => e.t));
  });

  it('finds the first offset of each chapter present', () => {
    const r = parseBundle(happyBundle());
    if (!r.ok) throw new Error('bundle should parse');
    expect(chapterOffsets(r.bundle)).toEqual({ bid: 1_000, hammer: 15_000, settle: 16_000 });
  });
});
