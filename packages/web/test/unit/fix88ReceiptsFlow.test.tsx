import { render, screen } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import { buildLadder } from '../../src/ladder/ladderModel';
import { Receipt, receiptJson } from '../../src/screens/receipt/Receipt';
import { Sold } from '../../src/screens/screen/Sold';
import { initialRoomState, reduce, type RoomState } from '../../src/store/roomReducer';
import { selectMyStatus } from '../../src/store/selectors';
import { bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import { BASE_TIME } from '../../src/testing/builders';
import { hold, settlementView } from '../../src/testing/scenarios/_kit';
import type { ServerMessage } from '../../src/wire';

const ME = 2;
const you = { bidderId: bidderId(ME), ceiling: Cents(20_000) };

function run(state: RoomState, ...msgs: ServerMessage[]): RoomState {
  let current = state;
  for (const msg of msgs) current = reduce(current, { kind: 'wire', msg }).state;
  return current;
}

function base(): RoomState {
  const snap = { ...openSnapshot(roster([1, 'Ana'], [ME, 'Bob'])), you };
  return run(initialRoomState(snap.auctionId), stateMsg(6, snap));
}

const hammer = (winner: number): ServerMessage => ({
  v: 1,
  t: 'hammer',
  seq: 7,
  ts: EpochMs(BASE_TIME + 7),
  winnerId: bidderId(winner),
  price: Cents(1_500),
  ranking: [],
});

const settle = (extra: Record<string, unknown>): ServerMessage =>
  ({
    v: 1,
    t: 'settlement_update',
    seq: 8,
    ts: EpochMs(BASE_TIME + 8),
    rev: 8,
    auctionState: 'SETTLED',
    you: 'SETTLED',
    ...extra,
  }) as ServerMessage;

describe('the winner is never shown as lost or released (FIX-88, #2237)', () => {
  it('keeps the hammer winner as won when the server reports SETTLED for them', () => {
    expect(selectMyStatus(run(base(), hammer(ME), settle({})))).toBe('won');
    expect(selectMyStatus(run(base(), hammer(ME), settle({ winnerPaddle: ME })))).toBe('won');
  });

  it('shows lost only when the server names another paddle as the winner', () => {
    expect(selectMyStatus(run(base(), hammer(ME), settle({ winnerPaddle: 1 })))).toBe('lost');
  });

  it('keeps a non-winner whose hold was released as lost', () => {
    expect(selectMyStatus(run(base(), hammer(1), settle({})))).toBe('lost');
  });

  it('does not label the winner lane Released while no charge is reported', () => {
    const view = settlementView('SETTLED', ME, [hold(ME, 'Bob', 20_000, 'SETTLED', 0, 0)]);
    const lane = buildLadder(view).lanes[0];
    expect(lane?.canSayReleased).toBe(false);
    expect(lane?.state).toBe('CAPTURING');
  });

  it('shows Charged on the winner lane once the charge is reported', () => {
    const view = settlementView('SETTLED', ME, [hold(ME, 'Bob', 20_000, 'SETTLED', 1_500, 18_500)]);
    const lane = buildLadder(view).lanes[0];
    expect(lane?.state).toBe('CAPTURED');
    expect(lane?.canSayReleased).toBe(false);
  });

  it('still calls a loser lane Released', () => {
    const view = settlementView('SETTLED', 1, [hold(ME, 'Bob', 20_000, 'SETTLED', 0, 20_000)]);
    expect(buildLadder(view).lanes[0]?.canSayReleased).toBe(true);
  });

  it('shows no "0 captured, N released" line for a sale with no charge reported', () => {
    render(
      <Sold
        outcome={{ kind: 'sold', paddle: 2, amountCents: 1_500 }}
        settlement={{ captured: 0, released: 2 }}
      />,
    );
    expect(screen.queryByTestId('settle-summary')).toBeNull();
    expect(screen.getByTestId('settle-pending').textContent).toBe(t('ladder.state.CAPTURING'));
  });
});

describe('receipts keep the sandbox notice when they leave the page (FIX-88, #2239)', () => {
  const view = settlementView('SETTLED', ME, [hold(ME, 'Bob', 20_000, 'CAPTURED', 1_500, 18_500)]);

  it('renders a sandbox line inside the receipt body', () => {
    const { container } = render(<Receipt view={view} paddle={ME} itemName="Vase" at={null} />);
    const line = screen.getByTestId('receipt-sandbox');
    expect(line.textContent).toBe(t('receipt.sandboxLine'));
    expect(line.closest('.gv-receipt')).not.toBeNull();
    expect(line.closest('.gv-banner')).toBeNull();
    expect(container.querySelector('.gv-banner')).toBeNull();
  });

  it('adds the sandbox marker and note to the JSON export', () => {
    const parsed = JSON.parse(receiptJson(view, ME, null)) as { sandbox: boolean; note: string };
    expect(parsed.sandbox).toBe(true);
    expect(parsed.note).toBe(t('receipt.sandboxNote'));
  });
});

describe('copy for the closed doors and the review notice (FIX-88, #2240, #2241)', () => {
  it('does not send the host to a runner-up control the console does not have', () => {
    expect(t('console.settlement.reviewNoRunnerUp')).not.toMatch(/runner/i);
  });

  it('keeps the approval-expired message out of the state headings', () => {
    for (const key of [
      'reg.checkingTitle',
      'reg.noInviteTitle',
      'reg.closedTitle',
      'reg.fullTitle',
      'reg.inviteFailedTitle',
      'reg.inviteFailed',
      'reg.returnLost',
    ] as const) {
      expect(t(key)).not.toMatch(/approval expired/i);
    }
  });
});
