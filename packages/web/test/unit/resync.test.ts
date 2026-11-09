import { describe, expect, it } from 'vitest';
import { RESYNC_RETRY_MS, bindResync } from '../../src/net/resync';
import { RoomStore } from '../../src/store/roomStore';
import { auctionId, openSnapshot, priceMsg, stateMsg } from '../../src/testing/builders';

const A = auctionId();

function harness() {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  // One entry per request for a fresh snapshot (a reconnect, never a second join on the socket).
  const sent: string[] = [];
  const store = new RoomStore(A);
  const unbind = bindResync(store, {
    requestSnapshot: () => sent.push('snapshot'),
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
  });
  const fire = (): void => {
    const t = timers.find((x) => x.live);
    if (t === undefined) throw new Error('no timer');
    t.live = false;
    t.fn();
  };
  return { store, sent, timers, unbind, fire };
}

describe('resync (WEB-RT-04, WEB-RT-05)', () => {
  it('asks for a fresh snapshot instead of a second join (#2226)', () => {
    const { store, sent } = harness();
    store.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot([])) });
    store.dispatch({ kind: 'wire', msg: priceMsg(4, 1, 1_000) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe('snapshot');
  });

  it('sends the join again until a snapshot arrives', () => {
    const { store, sent, timers, fire } = harness();
    store.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot([])) });
    store.dispatch({ kind: 'wire', msg: priceMsg(4, 1, 1_000) });
    expect(timers[0]?.ms).toBe(RESYNC_RETRY_MS);
    fire();
    fire();
    expect(sent).toHaveLength(3);
    store.dispatch({ kind: 'wire', msg: stateMsg(5, openSnapshot([])) });
    expect(store.getState().resyncing).toBe(false);
    expect(timers.some((t) => t.live)).toBe(false);
    expect(sent).toHaveLength(3);
  });

  it('stops everything when unbound', () => {
    const { store, sent, timers, unbind } = harness();
    store.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot([])) });
    store.dispatch({ kind: 'wire', msg: priceMsg(4, 1, 1_000) });
    unbind();
    expect(timers.some((t) => t.live)).toBe(false);
    store.dispatch({ kind: 'wire', msg: priceMsg(7, 1, 2_000) });
    expect(sent).toHaveLength(1);
  });
});
