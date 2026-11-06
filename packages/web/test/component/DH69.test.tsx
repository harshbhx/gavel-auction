import { act, render } from '@testing-library/react';
import { Cents, EpochMs, SETTLEMENT_STATES } from '@gavel/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReceiptRoute } from '../../src/App';
import { t } from '../../src/copy/t';
import type { HoldView, SettlementView } from '../../src/ladder/ladderModel';
import { Receipt } from '../../src/screens/receipt/Receipt';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { initialRoomState, reduce } from '../../src/store/roomReducer';
import { RoomStore, roomStore } from '../../src/store/roomStore';
import { BASE_TIME, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import { parseServerMessage, type ServerMessage } from '../../src/wire';

/** A settlement_update checked against the shared schema, shaped like the room sends it. */
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

function setup(me: number, ceiling: number): void {
  const snap = {
    ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
    you: { bidderId: bidderId(me), ceiling: Cents(ceiling) },
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

function send(msg: ServerMessage): void {
  act(() => roomStore.dispatch({ kind: 'wire', msg }));
}

function receiptText(container: HTMLElement): string {
  return container.querySelector('article.gv-receipt')?.textContent ?? '';
}

const WINNER_HOLD = {
  bidderId: bidderId(1),
  idSuffix: 'K7Q2ZA',
  status: 'CAPTURED',
  ceilingCents: 50000,
  capturedCents: 34000,
  releasedCents: 16000,
  remainder: 'released',
};

describe('real settlement frame, winner (yourHold and ladder, no holds, no invariants)', () => {
  beforeEach(() => setup(1, 50000));

  it('shows the reference, says the check was not reported and never says totals check out', () => {
    send(
      frame(3, {
        auctionState: 'CAPTURED',
        you: 'CAPTURED',
        amountCaptured: 34000,
        winnerPaddle: 1,
        ladder: { counts: counts(1, 1) },
        yourHold: WINNER_HOLD,
      }),
    );
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(receiptText(container)).toContain(t('receipt.reference', { suffix: 'K7Q2ZA' }));
    expect(receiptText(container)).toContain('Charged $340.00');
    const page = container.textContent ?? '';
    expect(page).toContain(t('ladder.invariantsNotReported'));
    expect(page).not.toContain('Totals check out');
    expect(page).not.toContain(t('ladder.invariants.bad'));
    expect(page).not.toContain(t('ladder.verify.pending'));
    expect(container.querySelector('.gv-ladder__log')).toBeNull();
  });

  it('shows the public summary from ladder.counts and no totals line on the screen', () => {
    const store = new RoomStore();
    store.dispatch({
      kind: 'wire',
      msg: stateMsg(5, {
        ...openSnapshot(roster([1, 'Ana']), undefined, 'DONE'),
        price: Cents(35000),
      }),
    });
    store.dispatch({
      kind: 'wire',
      msg: frame(6, { auctionState: 'CAPTURED', ladder: { counts: counts(1, 1) } }),
    });
    const { container } = render(
      <ScreenView lotTitle="Lot" code={null} joinUrl="https://x.test/j" store={store} />,
    );
    expect(container.textContent).toContain(t('screen.settleSummary', { c: 1, r: 1 }));
    expect(container.textContent).not.toContain('Totals check out');
  });

  it('keeps the viewer state apart from the auction state in the store', () => {
    let state = initialRoomState('a1');
    state = reduce(state, {
      kind: 'wire',
      msg: stateMsg(1, openSnapshot(roster([1, 'Ana']))),
    }).state;
    state = reduce(state, {
      kind: 'wire',
      msg: frame(2, { auctionState: 'CAPTURED', winnerPaddle: 1 }),
    }).state;
    expect(state.settlementMeta?.state).toBeNull();
    expect(state.settlementMeta?.auctionState).toBe('CAPTURED');
  });

  it('shows the price to be charged, never as charged, when no amount was captured', () => {
    send(frame(3, { auctionState: 'CAPTURED', you: 'CAPTURED', winnerPaddle: 1 }));
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = receiptText(container);
    expect(text).toContain(t('receipt.confirming'));
    expect(text).toContain(t('receipt.priceToCharge', { price: '$350.00' }));
    expect(text).not.toMatch(/Charged \$/);
  });
});

describe('real settlement frame, non-winner', () => {
  beforeEach(() => setup(2, 50000));

  // The released amount differs from the ceiling here only to prove which one is read.
  const own = {
    bidderId: bidderId(2),
    idSuffix: 'Q9X4TB',
    status: 'VOIDED',
    ceilingCents: 50000,
    capturedCents: 0,
    releasedCents: 49000,
    remainder: 'none',
  };

  it('shows the released amount from yourHold, not the ceiling', () => {
    send(
      frame(3, {
        auctionState: 'SETTLED',
        you: 'SETTLED',
        winnerPaddle: 1,
        ladder: { counts: counts(1, 1) },
        yourHold: own,
      }),
    );
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(receiptText(container)).toContain('Your $490.00 hold was released.');
    expect(receiptText(container)).not.toContain('$500.00');
    expect(container.textContent).toContain(t('ladder.invariantsNotReported'));
  });

  it('says releasing while the remainder is pending and gives no amount when none is reported', () => {
    send(
      frame(3, {
        auctionState: 'SETTLED',
        you: 'SETTLED',
        yourHold: { ...own, remainder: 'pending', releasedCents: 0 },
      }),
    );
    const pending = render(<ReceiptRoute roomId="lot1" />);
    expect(receiptText(pending.container)).toContain(t('receipt.releasing'));
    expect(receiptText(pending.container)).not.toContain('was released');
    pending.unmount();
    setup(2, 50000);
    send(frame(4, { auctionState: 'SETTLED', you: 'SETTLED' }));
    const bare = render(<ReceiptRoute roomId="lot1" />);
    expect(receiptText(bare.container)).toContain(t('receipt.releasedNoAmount'));
    expect(receiptText(bare.container)).not.toContain('$0.00');
  });

  it('treats a missing you as no hold: no winner claim, no charge, no amount', () => {
    send(frame(3, { auctionState: 'CAPTURED', amountCaptured: 34000, winnerPaddle: 1 }));
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = receiptText(container);
    expect(text).toContain(t('receipt.noHold'));
    expect(text).not.toMatch(/Charged/);
    expect(text).not.toContain('$340.00');
    expect(text).not.toContain('you are the winner');
    expect(text).not.toContain('Reference ending');
    expect(container.querySelector('time')).toBeNull();
  });

  it('still shows the promoted fallback when the server says this bidder is CAPTURED', () => {
    send(frame(3, { auctionState: 'CAPTURED', you: 'CAPTURED', amountCaptured: 30000 }));
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(receiptText(container)).toContain('you are the winner. Charged $300.00');
  });
});

describe('winner receipt while the capture runs', () => {
  it('shows the ceiling as held and the hammer price as the amount to be charged', () => {
    setup(1, 50000);
    send(frame(3, { auctionState: 'CAPTURING', you: 'CAPTURING', winnerPaddle: 1 }));
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(receiptText(container)).toContain(
      t('receipt.heldNotCharged', { ceiling: '$500.00', price: '$350.00' }),
    );
    expect(receiptText(container)).not.toMatch(/Charged \$/);
  });

  it('shows only the price line when the ceiling is unknown', () => {
    const hold: HoldView = {
      paddle: 1,
      name: 'Ana',
      ceilingCents: 0,
      state: 'CAPTURING',
      capturedCents: 0,
      releasedCents: 0,
      verifiedBy: [],
      idSuffix: '',
    };
    const view: SettlementView = {
      lotId: 'lot1',
      phase: 'CAPTURING',
      winnerPaddle: 1,
      hammerPriceCents: 20000,
      holds: [hold],
      invariants: { ok: false, violations: [], unreported: true },
    };
    const { container } = render(<Receipt view={view} paddle={1} itemName="Vase" at={null} />);
    expect(receiptText(container)).toContain(t('receipt.priceToCharge', { price: '$200.00' }));
    expect(receiptText(container)).not.toContain('Held $');
  });
});
