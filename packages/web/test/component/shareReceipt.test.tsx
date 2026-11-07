import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Cents, type RoomSnapshot } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { Receipt } from '../../src/screens/receipt/Receipt';
import { ShareControls, type ReceiptLink } from '../../src/screens/receipt/ShareControls';
import { clearAuctioneerToken } from '../../src/store/session';
import { auctionId, bidderId, openSnapshot, roster } from '../../src/testing/builders';
import type { SettlementView } from '../../src/ladder/ladderModel';

const LINK: ReceiptLink = {
  link: 'https://gavel.example/r/lot1/receipt#token=abc.def',
  expiresAt: 1_800_000_000_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('share controls', () => {
  it('makes the link on demand and shows it with a QR code', async () => {
    const mint = vi.fn(() => Promise.resolve(LINK));
    render(<ShareControls mint={mint} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('receipt.share.create') }));
    const field = await screen.findByLabelText(t('receipt.share.field'));
    expect((field as HTMLInputElement).value).toBe(LINK.link);
    expect(mint).toHaveBeenCalledTimes(1);
    // The QR is loaded lazily; its text alternative is the link.
    expect(await screen.findByRole('img', { name: LINK.link })).toBeTruthy();
    expect(document.body.textContent).toContain('display name, paddle');
  });

  it('copies with the clipboard when it can', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ShareControls mint={() => Promise.resolve(LINK)} />);
    fireEvent.click(screen.getByRole('button', { name: t('receipt.share.create') }));
    await screen.findByLabelText(t('receipt.share.field'));
    fireEvent.click(screen.getByRole('button', { name: t('receipt.share.copy') }));
    await screen.findByText(t('receipt.share.copied'));
    expect(writeText).toHaveBeenCalledWith(LINK.link);
  });

  it('selects the link text when the clipboard is missing or refuses', async () => {
    for (const nav of [
      {},
      { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    ]) {
      vi.stubGlobal('navigator', nav);
      const { unmount } = render(<ShareControls mint={() => Promise.resolve(LINK)} />);
      fireEvent.click(screen.getByRole('button', { name: t('receipt.share.create') }));
      const field = (await screen.findByLabelText(t('receipt.share.field'))) as HTMLInputElement;
      fireEvent.click(screen.getByRole('button', { name: t('receipt.share.copy') }));
      await screen.findByText(t('receipt.share.selected'));
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(LINK.link.length);
      expect(screen.queryByText(t('receipt.share.copied'))).toBeNull();
      unmount();
    }
  });

  it('says so when the link cannot be made', async () => {
    render(<ShareControls mint={() => Promise.resolve(null)} />);
    fireEvent.click(screen.getByRole('button', { name: t('receipt.share.create') }));
    await screen.findByText(t('receipt.share.failed'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

const VIEW: SettlementView = {
  lotId: auctionId(),
  phase: 'SETTLED',
  winnerPaddle: 1,
  hammerPriceCents: 35000,
  holds: [
    {
      paddle: 1,
      name: 'Ana',
      ceilingCents: 50000,
      state: 'CAPTURED',
      capturedCents: 35000,
      releasedCents: 15000,
      verifiedBy: [],
      idSuffix: 'AB12CD',
    },
  ],
  invariants: { ok: true, violations: [] },
};

describe('print or save as PDF', () => {
  it('opens the print dialog and does not claim a download', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<Receipt view={VIEW} paddle={1} itemName="Lot" at={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    const hint = screen.getByText(t('receipt.printHint'));
    expect(hint.textContent).toMatch(/print dialog/);
    expect(hint.textContent).not.toMatch(/download/i);
  });

  it('shows the share controls only when a mint function is given', () => {
    const { rerender } = render(<Receipt view={VIEW} paddle={1} itemName="Lot" at={null} />);
    expect(screen.queryByText(t('receipt.share.title'))).toBeNull();
    rerender(
      <Receipt
        view={VIEW}
        paddle={1}
        itemName="Lot"
        at={null}
        share={() => Promise.resolve(LINK)}
      />,
    );
    expect(screen.getByText(t('receipt.share.title'))).toBeTruthy();
  });
});

const API = { apiBase: 'http://api.test', payments: 'fake', paypalClientId: 'none' } as const;
const ROOM = auctionId();

function sharedSnapshot(): RoomSnapshot {
  const own = roster([2, 'Ben'])[0];
  const winner = roster([1, ''])[0];
  if (own === undefined || winner === undefined) throw new Error('fixture');
  return {
    ...openSnapshot([winner, own], undefined, 'DONE', ROOM),
    lotTitle: 'Signed vinyl',
    hammer: { winnerId: bidderId(1), price: Cents(35000) },
    settlement: {
      rev: 4,
      auctionState: 'SETTLED',
      you: 'SETTLED',
      yourHold: {
        bidderId: bidderId(2),
        idSuffix: 'EF34GH',
        status: 'VOIDED',
        ceilingCents: Cents(30000),
        capturedCents: Cents(0),
        releasedCents: Cents(30000),
        remainder: 'none',
      },
    },
  };
}

describe('opening a receipt link signed out', () => {
  beforeEach(() => {
    clearAuctioneerToken();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('shows the receipt from the token alone and takes the token out of the address bar', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            bidderId: bidderId(2),
            snapshot: sharedSnapshot(),
            expiresAt: 1_800_000_000_000,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', `/r/${ROOM}/receipt#token=RECEIPT.TOKEN`);
    render(<App initialPath={`/r/${ROOM}/receipt`} api={API} />);
    await screen.findByText(t('receipt.title'));
    expect(screen.getByText(t('receipt.shared.readOnly'))).toBeTruthy();
    expect(document.body.textContent).toContain('Signed vinyl');
    expect(document.body.textContent).toContain('You did not win');
    // One read-only call, with the receipt token only; no share controls, no audit link.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe(`http://api.test/api/auctions/${ROOM}/receipt`);
    expect(call?.[1]?.headers).toEqual({ authorization: 'Bearer RECEIPT.TOKEN' });
    expect(screen.queryByText(t('receipt.share.title'))).toBeNull();
    expect(document.querySelector('a[href*="audit"]')).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('says the link is not valid when the server refuses the token', async () => {
    clearAuctioneerToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    window.history.replaceState(null, '', `/r/${ROOM}/receipt#token=EXPIRED.TOKEN`);
    await act(async () => {
      render(<App initialPath={`/r/${ROOM}/receipt`} api={API} />);
    });
    await waitFor(() => expect(screen.getByText(t('receipt.shared.invalid'))).toBeTruthy());
    expect(screen.queryByText(t('receipt.title'))).toBeNull();
  });
});
