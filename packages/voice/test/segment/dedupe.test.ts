import { describe, expect, it } from 'vitest';
import {
  DuplicateFilter,
  PendingCandidateStore,
  idempotencyKey,
} from '../../src/segment/dedupe.js';

describe('T-VOX-032 duplicates and idempotency key (R-VOX-032)', () => {
  it('drops the same final delivered twice 800 ms apart', () => {
    const f = new DuplicateFilter();
    expect(f.isDuplicate('Paddle nine, two fifty', 1000)).toBe(false);
    expect(f.isDuplicate('paddle nine two fifty', 1800)).toBe(true);
  });

  it('processes the same text 2000 ms apart', () => {
    const f = new DuplicateFilter();
    expect(f.isDuplicate('two fifty', 0)).toBe(false);
    expect(f.isDuplicate('two fifty', 2000)).toBe(false);
  });

  it('does not treat different text as a duplicate', () => {
    const f = new DuplicateFilter();
    expect(f.isDuplicate('two fifty', 0)).toBe(false);
    expect(f.isDuplicate('three hundred', 100)).toBe(false);
  });

  it('builds a stable key', () => {
    const a = idempotencyKey('room1', 'lot1', 1200, 'two fifty');
    expect(idempotencyKey('room1', 'lot1', 1200, 'two fifty')).toBe(a);
    expect(idempotencyKey('room1', 'lot1', 1300, 'two fifty')).not.toBe(a);
    expect(idempotencyKey('room1', 'lot1', 1200, 'two sixty')).not.toBe(a);
    expect(a).toMatch(/^room1:lot1:1200:[0-9a-f]{12}$/);
  });
});

describe('T-VOX-034 pending candidate context (R-VOX-034)', () => {
  const candidate = {
    id: 'c1',
    bidder: { kind: 'paddle' as const, value: '7' },
    amountCents: 35000,
  };

  it('exposes a 5000 ms old candidate with its age', () => {
    const s = new PendingCandidateStore();
    s.set(candidate, 1000);
    expect(s.get(6000)).toEqual({ ...candidate, ageMs: 5000 });
  });

  it('hides a 9000 ms old candidate and a cleared one', () => {
    const s = new PendingCandidateStore();
    expect(s.get(0)).toBeUndefined();
    s.set(candidate, 1000);
    expect(s.get(10000)).toBeUndefined();
    s.set(candidate, 1000);
    s.clear();
    expect(s.get(2000)).toBeUndefined();
  });
});
