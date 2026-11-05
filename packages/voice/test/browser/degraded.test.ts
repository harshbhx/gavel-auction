import { describe, expect, it } from 'vitest';
import { DEGRADED_MESSAGE, messageFor, reduce } from '../../src/browser/capture-state.js';
import { DropMonitor } from '../../src/browser/degraded.js';

const stats = (droppedMs: number) => ({ length: 0, droppedBatches: 0, droppedMs });

describe('DropMonitor', () => {
  it('T-VOX-009: degraded after 2100 ms dropped, running after 10 s clean', () => {
    const m = new DropMonitor();
    expect(m.record(stats(0), 0)).toBeNull();
    const ev = m.record(stats(2100), 1000);
    expect(ev).toEqual({ type: 'queue_drop' });
    const state = reduce('running', ev ?? { type: 'stop' });
    expect(state).toBe('degraded');
    expect(messageFor(state)).toBe(DEGRADED_MESSAGE);
    expect(m.record(stats(2100), 5000)).toBeNull();
    const rec = m.record(stats(2100), 11000);
    expect(rec).toEqual({ type: 'recovered' });
    expect(reduce('degraded', rec ?? { type: 'stop' })).toBe('running');
  });

  it('does not trip at exactly 2000 ms', () => {
    const m = new DropMonitor();
    expect(m.record(stats(2000), 100)).toBeNull();
  });

  it('drops spread beyond the window do not accumulate', () => {
    const m = new DropMonitor();
    expect(m.record(stats(1500), 0)).toBeNull();
    expect(m.record(stats(1500), 9000)).toBeNull();
    expect(m.record(stats(3000), 20000)).toBeNull();
  });

  it('new drops while degraded postpone recovery', () => {
    const m = new DropMonitor();
    m.record(stats(0), 0);
    expect(m.record(stats(2500), 1000)).toEqual({ type: 'queue_drop' });
    expect(m.record(stats(2600), 8000)).toBeNull();
    expect(m.record(stats(2600), 12000)).toBeNull();
    expect(m.record(stats(2600), 18000)).toEqual({ type: 'recovered' });
  });
});
