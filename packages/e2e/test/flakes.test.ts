import { describe, expect, it } from 'vitest';
import { emptyLog, findFlakes, isQuarantined, recordFlakes, tagTitle } from '../src/report/flakes';

const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-11-01T00:00:00Z');

describe('flakes', () => {
  it('finds only tests that passed after a retry', () => {
    const out = findFlakes([
      { test: 'a', retries: 1, passed: true },
      { test: 'b', retries: 0, passed: true },
      { test: 'c', retries: 2, passed: false },
    ]);
    expect(out).toEqual(['a']);
  });

  it('records a flake without quarantining the first time', () => {
    const r = recordFlakes(emptyLog(), ['a'], t0);
    expect(r.log.flakes).toHaveLength(1);
    expect(r.newlyQuarantined).toEqual([]);
  });

  it('quarantines on the second flake within 7 days', () => {
    const first = recordFlakes(emptyLog(), ['a'], t0);
    const second = recordFlakes(first.log, ['a'], new Date(t0.getTime() + 3 * day));
    expect(second.newlyQuarantined).toEqual(['a']);
    const third = recordFlakes(second.log, ['a'], new Date(t0.getTime() + 4 * day));
    expect(third.newlyQuarantined).toEqual([]);
  });

  it('does not quarantine when the first flake is older than 7 days', () => {
    const first = recordFlakes(emptyLog(), ['a'], t0);
    const second = recordFlakes(first.log, ['a'], new Date(t0.getTime() + 8 * day));
    expect(second.newlyQuarantined).toEqual([]);
  });

  it('tags titles once', () => {
    const tagged = tagTitle('login works');
    expect(isQuarantined(tagged)).toBe(true);
    expect(tagTitle(tagged)).toBe(tagged);
    expect(isQuarantined('login works')).toBe(false);
  });
});
