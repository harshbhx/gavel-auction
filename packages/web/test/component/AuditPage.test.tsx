import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditPage } from '../../src/screens/audit/AuditPage';
import { initialRoomState, type RoomState } from '../../src/store/roomReducer';
import {
  BASE_TIME,
  auctionId,
  bidId,
  bidderId,
  openSnapshot,
  roster,
} from '../../src/testing/builders';
import type { AuditPayload } from '../../src/wire';

function row(
  seq: number,
  paddle: number,
  outcome: AuditPayload['outcome'],
  cents?: number,
): AuditPayload {
  return {
    bidId: bidId(seq),
    bidderId: bidderId(paddle),
    source: 'manual',
    outcome,
    serverTs: EpochMs(BASE_TIME + seq * 1000),
    seq,
    ...(cents === undefined ? {} : { parsedAmount: Cents(cents) }),
  } as AuditPayload;
}

function room(extra: Partial<RoomState> = {}): RoomState {
  return {
    ...initialRoomState(auctionId()),
    snapshot: { ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])), lotTitle: 'Signed poster' },
    audit: [row(1, 1, 'accepted', 5000), row(2, 2, 'accepted', 10000), row(3, 1, 'rejected', 9000)],
    ...extra,
  };
}

describe('AuditPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/r/x/audit');
  });

  it('explains the page and shows the summary strip', () => {
    render(<AuditPage state={room()} roomId="x" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Audit trail' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /how to read it/ })).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Signed poster')).toBeTruthy();
    expect(within(summary).getByText('Leading bid')).toBeTruthy();
    expect(within(summary).getByText('2 accepted of 3 attempts')).toBeTruthy();
    expect(within(summary).getByText('Bidders').nextElementSibling?.textContent).toBe('2');
  });

  it('tells the story in the timeline and lists attempts in a ledger with readable headings', () => {
    render(<AuditPage state={room()} roomId="x" />);
    const tl = screen.getByRole('region', { name: 'Timeline' });
    expect(within(tl).getByText(/was outbid by Paddle 2, Ben/)).toBeTruthy();
    expect(within(tl).getAllByText(/Held, not charged/, { selector: 'p' })).toHaveLength(2);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads.some((h) => h?.includes('Time (UTC)'))).toBe(true);
    expect(heads.some((h) => h?.includes('Result'))).toBe(true);
  });

  it('opens a readable detail sheet from the timeline and steps through entries', () => {
    render(<AuditPage state={room()} roomId="x" />);
    const tl = screen.getByRole('region', { name: 'Timeline' });
    fireEvent.click(within(tl).getAllByRole('button', { name: /Entry 2/ })[0] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: 'Entry 2' });
    expect(within(dialog).getByText('Paddle 2, Ben bid $100.00 by hand.')).toBeTruthy();
    expect(JSON.parse(within(dialog).getByTestId('audit-json').textContent ?? '')).toMatchObject({
      seq: 2,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next entry' }));
    expect(screen.getByRole('dialog', { name: 'Entry 3' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('filters both lists by type from the address bar', () => {
    window.history.replaceState(null, '', '/r/x/audit?type=rejected');
    render(<AuditPage state={room()} roomId="x" />);
    const tl = screen.getByRole('region', { name: 'Timeline' });
    expect(within(tl).queryByText(/was outbid/)).toBeNull();
    expect(within(tl).getByText(/was not accepted/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Showing 1 of 6 lines')).toBeTruthy();
  });

  it('says when filters hide everything', () => {
    window.history.replaceState(null, '', '/r/x/audit?q=zzzz');
    render(<AuditPage state={room()} roomId="x" />);
    expect(screen.getByText('No lines match these filters.')).toBeTruthy();
    expect(screen.getByText('No rows match these filters.')).toBeTruthy();
  });

  it('puts the chain and reviewer slots beside the summary and guide', () => {
    render(
      <AuditPage
        state={room()}
        roomId="x"
        chain={<p>chain slot</p>}
        reviewer={<p>reviewer slot</p>}
      />,
    );
    expect(screen.getByText('chain slot')).toBeTruthy();
    expect(screen.getByText('reviewer slot')).toBeTruthy();
    expect(document.querySelector('.gv-audit__top')?.getAttribute('data-chain')).toBe('present');
  });

  it('shows the loading and empty states', () => {
    const loading = render(<AuditPage state={{ ...room(), snapshot: null }} roomId="x" />);
    expect(screen.getByRole('status', { busy: true })).toBeTruthy();
    loading.unmount();
    const empty = room({ audit: [], snapshot: { ...openSnapshot([]) } });
    render(<AuditPage state={empty} roomId="x" />);
    expect(screen.getByText('No events yet')).toBeTruthy();
  });

  it('copies the timeline as text and the link, and reports the result', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<AuditPage state={room()} roomId="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy timeline as text' }));
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Bid: Paddle 2, Ben bid $100.00'),
    );
    expect(screen.getByText('Copied')).toBeTruthy();
    writeText.mockRejectedValueOnce(new Error('no'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }));
    });
    expect(screen.getByText(/Could not copy/)).toBeTruthy();
  });

  it('adds the hammer and the receipt link after the hammer', () => {
    const state = room({
      hammer: {
        v: 1,
        t: 'hammer',
        seq: 9,
        ts: EpochMs(BASE_TIME + 9000),
        winnerId: bidderId(2),
        price: Cents(10000),
        ranking: [],
      } as never,
    });
    render(<AuditPage state={state} roomId="x" />);
    expect(screen.getByText('Paddle 2, Ben won at $100.00. The hammer fell.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the receipt' }).getAttribute('href')).toBe(
      '/r/x/receipt',
    );
    expect(screen.getByText('Winning bid')).toBeTruthy();
  });
});
