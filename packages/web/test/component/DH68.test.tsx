import { act, fireEvent, render, screen } from '@testing-library/react';
import { Cents, EpochMs, SETTLEMENT_STATES } from '@gavel/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditRoute, ReceiptRoute } from '../../src/App';
import { t } from '../../src/copy/t';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { initialRoomState, reduce } from '../../src/store/roomReducer';
import { RoomStore, roomStore } from '../../src/store/roomStore';
import {
  BASE_TIME,
  auctionId,
  bidId,
  bidderId,
  openSnapshot,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import { parseServerMessage, type AuditPayload, type ServerMessage } from '../../src/wire';

/** A settlement_update frame, checked against the shared server schema. */
function frame(seq: number, body: Record<string, unknown>): ServerMessage {
  const msg = parseServerMessage({
    v: 1,
    t: 'settlement_update',
    seq,
    ts: BASE_TIME + seq * 1000,
    rev: seq,
    ...body,
  });
  if (msg === null) throw new Error('frame does not match the shared schema');
  return msg;
}

function counts(captured: number, settled: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SETTLEMENT_STATES) out[s] = 0;
  out['CAPTURED'] = captured;
  out['SETTLED'] = settled;
  return out;
}

const OWN = {
  bidderId: bidderId(1),
  idSuffix: 'K7Q2ZA',
  status: 'CAPTURED',
  ceilingCents: 50000,
  capturedCents: 34000,
  releasedCents: 16000,
  remainder: 'released',
};

describe('store keeps yourHold and ladder counts', () => {
  it('stores both from a settlement_update and keeps them over a frame without them', () => {
    let state = initialRoomState('a1');
    state = reduce(state, {
      kind: 'wire',
      msg: stateMsg(1, openSnapshot(roster([1, 'Ana']))),
    }).state;
    state = reduce(state, {
      kind: 'wire',
      msg: frame(2, {
        auctionState: 'CAPTURED',
        you: 'CAPTURED',
        yourHold: OWN,
        ladder: { counts: counts(1, 3) },
      }),
    }).state;
    expect(state.ownHold?.idSuffix).toBe('K7Q2ZA');
    expect(state.ownHold?.remainder).toBe('released');
    expect(state.settlementLadderCounts?.['SETTLED']).toBe(3);
    state = reduce(state, {
      kind: 'wire',
      msg: frame(3, { auctionState: 'SETTLED', you: 'SETTLED' }),
    }).state;
    expect(state.ownHold?.capturedCents).toBe(34000);
    expect(state.settlementLadderCounts?.['CAPTURED']).toBe(1);
  });

  it('ignores a stale frame', () => {
    let state = initialRoomState('a1');
    state = reduce(state, {
      kind: 'wire',
      msg: stateMsg(1, openSnapshot(roster([1, 'Ana']))),
    }).state;
    state = reduce(state, {
      kind: 'wire',
      msg: frame(2, { rev: 5, auctionState: 'CAPTURED', yourHold: OWN }),
    }).state;
    state = reduce(state, {
      kind: 'wire',
      msg: frame(3, {
        rev: 2,
        auctionState: 'CAPTURING',
        yourHold: { ...OWN, capturedCents: 0, status: 'HELD', remainder: 'none' },
      }),
    }).state;
    expect(state.ownHold?.capturedCents).toBe(34000);
  });
});

function setupReceipt(): void {
  const snap = {
    ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
    you: { bidderId: bidderId(1), ceiling: Cents(10000) },
  };
  act(() => roomStore.dispatch({ kind: 'reset' }));
  act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap) }));
  act(() =>
    roomStore.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'hammer',
        seq: 2,
        ts: EpochMs(BASE_TIME + 2),
        winnerId: bidderId(1),
        price: Cents(35000),
        ranking: [],
      },
    }),
  );
}

describe('receipt route reads yourHold', () => {
  beforeEach(setupReceipt);

  it('shows the reference and the captured amount from yourHold', () => {
    act(() =>
      roomStore.dispatch({
        kind: 'wire',
        msg: frame(3, { auctionState: 'CAPTURED', you: 'CAPTURED', yourHold: OWN }),
      }),
    );
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = container.querySelector('article.gv-receipt')?.textContent ?? '';
    expect(text).toContain(t('receipt.reference', { suffix: 'K7Q2ZA' }));
    expect(text).toContain('Charged $340.00');
  });

  it('still renders from an older frame without yourHold', () => {
    act(() =>
      roomStore.dispatch({
        kind: 'wire',
        msg: frame(3, {
          auctionState: 'CAPTURED',
          you: 'CAPTURED',
          amountCaptured: 34000,
        }),
      }),
    );
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = container.querySelector('article.gv-receipt')?.textContent ?? '';
    expect(text).toContain('Charged $340.00');
    expect(text).not.toContain('Reference ending');
  });
});

function closedScreenStore(): RoomStore {
  const store = new RoomStore();
  const snap = {
    ...openSnapshot(roster([7, 'Eve']), undefined, 'DONE'),
    price: Cents(25_000),
    leaderId: bidderId(7),
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(5, snap) });
  return store;
}

describe('public screen reads ladder counts', () => {
  it('shows the counts the server sent, not a derived pair', () => {
    const store = closedScreenStore();
    store.dispatch({
      kind: 'wire',
      msg: frame(6, { auctionState: 'SETTLED', ladder: { counts: counts(2, 5) } }),
    });
    render(<ScreenView lotTitle="Lot" code={null} joinUrl="https://x.test/j" store={store} />);
    expect(screen.getByTestId('settle-summary').textContent).toBe(
      t('screen.settleSummary', { c: 2, r: 5 }),
    );
  });

  it('shows no summary for an older frame without counts or holds', () => {
    const store = closedScreenStore();
    store.dispatch({ kind: 'wire', msg: frame(6, { auctionState: 'SETTLED' }) });
    render(<ScreenView lotTitle="Lot" code={null} joinUrl="https://x.test/j" store={store} />);
    expect(screen.queryByTestId('settle-summary')).toBeNull();
  });
});

describe('audit route shows the audio window', () => {
  it('shows start and end of a voice row', () => {
    window.history.replaceState(null, '', '/audit');
    const row = {
      bidId: bidId(2),
      bidderId: bidderId(1),
      source: 'voice',
      audioTsMs: 12345,
      audioEndMs: 14000,
      outcome: 'accepted',
      serverTs: BASE_TIME + 2,
      seq: 2,
    } as AuditPayload;
    const snap = { ...openSnapshot(roster([1, 'Ana'])), recentAudit: [row] };
    act(() => {
      roomStore.enter(auctionId());
      roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap) });
    });
    render(<AuditRoute />);
    // The grid is the default ledger view; the audio window is in the plain table.
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByText(`00:12.345 ${String.fromCharCode(0x2013)} 00:14.000`)).toBeTruthy();
  });
});
