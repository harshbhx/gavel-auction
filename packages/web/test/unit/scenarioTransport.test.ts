import { Cents } from '@gavel/shared';
import { describe, expect, it, vi } from 'vitest';
import { ScenarioTransport } from '../../src/net/scenarioTransport';
import type { Scenario, ScenarioStep } from '../../src/net/transport';
import { baseConfig, msgId, priceMsg } from '../../src/testing/builders';
import type { PriceMsg, ServerMessage } from '../../src/wire';

const price = (seq: number, cents: number): PriceMsg => priceMsg(seq, 1, cents);

function scenario(steps: ScenarioStep[]): Scenario {
  return { name: 't', description: 'test', roomConfig: baseConfig, steps };
}

function collect(t: ScenarioTransport): ServerMessage[] {
  const out: ServerMessage[] = [];
  t.onMessage((m) => out.push(m));
  return out;
}

const seqs = (ms: ServerMessage[]): number[] => ms.map((m) => m.seq ?? 0);

describe('ScenarioTransport', () => {
  it('delivers steps in time order as the clock advances, with no network', () => {
    const t = new ScenarioTransport(
      scenario([
        { at: 100, emit: price(1, 1000) },
        { at: 300, emit: price(2, 2000) },
      ]),
    );
    const out = collect(t);
    t.connect();
    expect(out).toHaveLength(0);
    t.advance(100);
    expect(seqs(out)).toEqual([1]);
    t.advance(199);
    expect(seqs(out)).toEqual([1]);
    t.advance(1);
    expect(seqs(out)).toEqual([1, 2]);
  });

  it('reports connecting, open and closed', () => {
    const t = new ScenarioTransport(scenario([]));
    const seen: string[] = [];
    t.onStatus((s) => seen.push(s));
    t.connect();
    t.close();
    expect(seen).toEqual(['connecting', 'open', 'closed']);
  });

  it('unsubscribes listeners', () => {
    const t = new ScenarioTransport(scenario([{ at: 0, emit: price(1, 1) }]));
    const out: ServerMessage[] = [];
    const off = t.onMessage((m) => out.push(m));
    off();
    t.connect();
    expect(out).toHaveLength(0);
  });

  it('drop skips the message', () => {
    const t = new ScenarioTransport(
      scenario([
        { at: 0, emit: price(1, 1), fault: 'drop' },
        { at: 10, emit: price(2, 2) },
      ]),
    );
    const out = collect(t);
    t.connect();
    t.advance(10);
    expect(seqs(out)).toEqual([2]);
  });

  it('dup delivers twice', () => {
    const t = new ScenarioTransport(scenario([{ at: 5, emit: price(1, 1), fault: 'dup' }]));
    const out = collect(t);
    t.connect();
    t.advance(5);
    expect(seqs(out)).toEqual([1, 1]);
  });

  it('reorder swaps the message with the next one', () => {
    const t = new ScenarioTransport(
      scenario([
        { at: 0, emit: price(1, 1), fault: 'reorder' },
        { at: 10, emit: price(2, 2) },
        { at: 20, emit: price(3, 3) },
      ]),
    );
    const out = collect(t);
    t.connect();
    t.advance(100);
    expect(seqs(out)).toEqual([2, 1, 3]);
  });

  it('delay:<ms> holds the message back', () => {
    const t = new ScenarioTransport(
      scenario([
        { at: 0, emit: price(1, 1), fault: 'delay:50' },
        { at: 10, emit: price(2, 2) },
      ]),
    );
    const out = collect(t);
    t.connect();
    t.advance(10);
    expect(seqs(out)).toEqual([2]);
    t.advance(40);
    expect(seqs(out)).toEqual([2, 1]);
  });

  it('disconnect closes the transport and drops what follows until connect()', () => {
    const t = new ScenarioTransport(
      scenario([
        { at: 0, emit: price(1, 1) },
        { at: 10, fault: 'disconnect' },
        { at: 20, emit: price(2, 2) },
        { at: 40, emit: price(3, 3) },
      ]),
    );
    const out = collect(t);
    const seen: string[] = [];
    t.onStatus((s) => seen.push(s));
    t.connect();
    t.advance(30);
    expect(t.currentStatus).toBe('closed');
    expect(seqs(out)).toEqual([1]);
    t.connect();
    t.advance(10);
    expect(seen).toEqual(['connecting', 'open', 'closed', 'connecting', 'open']);
    expect(seqs(out)).toEqual([1, 3]);
  });

  it('is deterministic: the same scenario gives the same delivery every time', () => {
    const steps: ScenarioStep[] = [
      { at: 0, emit: price(1, 1), fault: 'reorder' },
      { at: 5, emit: price(2, 2), fault: 'dup' },
      { at: 9, emit: price(3, 3), fault: 'delay:7' },
    ];
    const run = (): number[] => {
      const t = new ScenarioTransport(scenario(steps));
      const out = collect(t);
      t.connect();
      t.advance(1000);
      return seqs(out);
    };
    expect(run()).toEqual(run());
  });

  it('checks expectClient against what the client sent', () => {
    const t = new ScenarioTransport(
      scenario([{ at: 0, expectClient: { t: 'bid', amount: Cents(5000) } }]),
    );
    t.connect();
    expect(t.expectationsMet()).toBe(false);
    t.send({ v: 1, t: 'bid', mid: msgId(1), amount: Cents(5000), source: 'qr' });
    expect(t.expectationsMet()).toBe(true);
  });

  it('autoplay follows an injected scheduler', () => {
    vi.useFakeTimers();
    try {
      const t = new ScenarioTransport(
        scenario([
          { at: 100, emit: price(1, 1) },
          { at: 250, emit: price(2, 2) },
        ]),
      );
      const out = collect(t);
      t.connect();
      t.autoplay();
      vi.advanceTimersByTime(100);
      expect(seqs(out)).toEqual([1]);
      vi.advanceTimersByTime(150);
      expect(seqs(out)).toEqual([1, 2]);
      t.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
