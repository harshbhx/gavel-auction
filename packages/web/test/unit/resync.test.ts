import { describe, expect, it } from 'vitest';
import { ConnectionManager } from '../../src/net/connection';
import { RESYNC_RETRY_MS, bindResync } from '../../src/net/resync';
import type { Transport } from '../../src/net/transport';
import { RoomStore } from '../../src/store/roomStore';
import { auctionId, openSnapshot, priceMsg, stateMsg } from '../../src/testing/builders';
import type { ClientMessage } from '../../src/wire';

const A = auctionId();

function harness() {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const sent: ClientMessage[] = [];
  const transport: Transport = {
    connect: () => {},
    send: (m) => sent.push(m),
    onMessage: () => () => {},
    onStatus: () => () => {},
    close: () => {},
  };
  const store = new RoomStore(A);
  const manager = new ConnectionManager({
    transport,
    auctionId: A,
    getLastSeq: () => store.getState().lastSeq,
    getToken: () => 'bidder-token',
    onMessage: () => {},
  });
  const unbind = bindResync(store, {
    sendJoin: () => manager.sendJoin(),
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
  it('sends the resync join through the connection, with the session token', () => {
    const { store, sent } = harness();
    store.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot([])) });
    store.dispatch({ kind: 'wire', msg: priceMsg(4, 1, 1_000) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'join', token: 'bidder-token', lastSeq: 1 });
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
