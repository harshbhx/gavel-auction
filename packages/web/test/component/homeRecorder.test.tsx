import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { HISTORY_KEY, readHistory } from '../../src/home/history';
import { summarize } from '../../src/home/HistoryRecorder';
import { createJudgeRoom } from '../../src/net/judgeRooms';
import { ScenarioTransport } from '../../src/net/scenarioTransport';
import { roomStore } from '../../src/store/roomStore';
import { clearBidderSession, rememberBidderSession } from '../../src/store/session';
import { happy } from '../../src/testing/scenarios/happy';

const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;

afterEach(() => {
  window.sessionStorage.clear();
  clearBidderSession();
  vi.unstubAllGlobals();
});

describe('history recorder', () => {
  it('remembers a bidder room by id and role, and never writes the token', () => {
    rememberBidderSession('roomZ', { token: 'bidder-secret-token', bidderId: 'b1' });
    render(<App initialPath="/r/roomZ/bid" api={API} />);
    const [room] = readHistory();
    expect(room).toMatchObject({ roomId: 'roomZ', roles: ['bidder'] });
    expect(window.localStorage.getItem(HISTORY_KEY)).not.toContain('bidder-secret-token');
  });

  it('does not turn a mistyped address into a remembered room', () => {
    render(<App initialPath="/r/nosuchroom/bid" api={API} />);
    expect(readHistory()).toEqual([]);
  });

  it('does not record the scripted demo room', () => {
    rememberBidderSession('demo', { token: 'x', bidderId: 'b1' });
    render(<App initialPath="/r/demo/bid" api={API} />);
    expect(readHistory()).toEqual([]);
  });

  it('records a room made by this browser, with the join code and no token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              auctionId: 'roomNew',
              auctioneerToken: 'AUC-SECRET-1',
              screenToken: 'SCR-SECRET-2',
              reviewerToken: 'REV-SECRET-3',
              expiresAt: 1_900_000_000_000,
              joinCode: 'K7M2QX',
            }),
            { status: 201 },
          ),
        ),
      ),
    );
    await createJudgeRoom('http://localhost:1');
    const [room] = readHistory();
    expect(room).toMatchObject({
      roomId: 'roomNew',
      roles: ['auctioneer'],
      code: 'K7M2QX',
      expiresAt: 1_900_000_000_000,
    });
    const raw = window.localStorage.getItem(HISTORY_KEY) ?? '';
    for (const secret of ['AUC-SECRET-1', 'SCR-SECRET-2', 'REV-SECRET-3']) {
      expect(raw).not.toContain(secret);
    }
  });
});

describe('summary of the live room', () => {
  beforeEach(() => {
    roomStore.enter('');
  });

  function play(untilMs: number): string {
    const transport = new ScenarioTransport(happy);
    transport.onMessage((msg) => roomStore.dispatch({ kind: 'wire', msg }, 0));
    transport.connect();
    transport.advance(untilMs);
    return roomStore.getState().auctionId;
  }

  it('says nothing about a room the store is not in', () => {
    play(5_000);
    expect(summarize('someOtherRoom', 'watcher')).toEqual({});
  });

  it('an open lot: the last price, no receipt yet', () => {
    const id = play(5_000);
    expect(summarize(id, 'watcher')).toMatchObject({ result: 'open', receipt: false });
  });

  it('after the hammer: closed, the hammer price, a receipt', () => {
    const id = play(15_500);
    expect(summarize(id, 'watcher')).toMatchObject({
      result: 'closed',
      receipt: true,
      lastPriceCents: 35_000,
    });
  });

  it('a watcher or auctioneer never gets a hold amount', () => {
    const id = play(15_500);
    expect(summarize(id, 'auctioneer')).not.toHaveProperty('holdCents');
  });
});
