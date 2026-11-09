import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerifyPanel, unwrapLedger, verdictForText } from '../../src/chain/VerifyPanel';
import { t } from '../../src/copy/t';
import type { LedgerFetch } from '../../src/net/judgeRooms';
import { forgetHubKeys, rememberHubKeys } from '../../src/screens/hub/hubKeys';
import { VerifyScreen } from '../../src/screens/verify/VerifyScreen';
import { App } from '../../src/App';
import { makeLedgerBundle, tamperedBundle } from '../support/ledgerBundle';

afterEach(() => {
  forgetHubKeys();
  vi.restoreAllMocks();
});

const ROOM = { roomId: 'room-1', reviewer: 'rev-token', audit: '/r/room-1/audit#token=rev-token' };
const paste = (value: string): void => {
  fireEvent.change(screen.getByLabelText(t('verify.paste.label')), { target: { value } });
};
const check = (): void => {
  fireEvent.click(screen.getByRole('button', { name: t('verify.check') }));
};

describe('verdictForText', () => {
  it('reads a bundle, a bundle inside a recording and refuses the rest', () => {
    const text = JSON.stringify(makeLedgerBundle());
    expect(verdictForText(text).kind).toBe('verified');
    expect(verdictForText(JSON.stringify({ title: 'x', ledger: makeLedgerBundle() })).kind).toBe(
      'verified',
    );
    expect(verdictForText('not json').kind).toBe('invalid');
    expect(verdictForText('{"a":1}').kind).toBe('invalid');
    expect(verdictForText('   ').kind).toBe('none');
    expect(unwrapLedger(5)).toBe(5);
  });
});

describe('VerifyPanel', () => {
  it('shows no verdict until something is checked', () => {
    render(<VerifyPanel />);
    expect(screen.queryByText(t('chain.verified'))).toBeNull();
    expect(
      (screen.getByRole('button', { name: t('verify.check') }) as HTMLButtonElement).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
  });

  it('verifies a pasted export', () => {
    render(<VerifyPanel />);
    paste(JSON.stringify(makeLedgerBundle()));
    check();
    expect(screen.getByText(t('chain.verified'))).toBeTruthy();
  });

  it('names the entry that was edited', () => {
    render(<VerifyPanel />);
    paste(JSON.stringify(tamperedBundle(0)));
    check();
    expect(screen.getByText(t('chain.broken', { n: 1 }))).toBeTruthy();
  });

  it('says plainly when the text is not a ledger', () => {
    render(<VerifyPanel />);
    paste('hello');
    check();
    expect(screen.getByText(t('chain.invalid'))).toBeTruthy();
  });

  it('checks a picked file', async () => {
    render(<VerifyPanel />);
    const file = new File([JSON.stringify(makeLedgerBundle())], 'ledger.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText(t('verify.file')), { target: { files: [file] } });
    expect(await screen.findByText(t('chain.verified'))).toBeTruthy();
    expect((screen.getByLabelText(t('verify.paste.label')) as HTMLTextAreaElement).value).toContain(
      'headHash',
    );
  });

  it('loads the ledger of the visitor room through the reviewer token', async () => {
    const loadLedger = vi.fn(
      (): Promise<LedgerFetch> => Promise.resolve({ kind: 'ok', ledger: makeLedgerBundle() }),
    );
    render(<VerifyPanel room={ROOM} apiBase="https://api.example.test" loadLedger={loadLedger} />);
    fireEvent.click(screen.getByRole('button', { name: t('verify.room.button') }));
    expect(await screen.findByText(t('chain.verified'))).toBeTruthy();
    expect(loadLedger).toHaveBeenCalledWith('https://api.example.test', 'room-1', 'rev-token');
    const link = screen.getByRole('link', { name: t('verify.audit') });
    expect(link.getAttribute('href')).toBe(ROOM.audit);
  });

  it('flags a room ledger that fails the check', async () => {
    const loadLedger = (): Promise<LedgerFetch> =>
      Promise.resolve({ kind: 'ok', ledger: tamperedBundle(1) });
    render(<VerifyPanel room={ROOM} apiBase="https://api.example.test" loadLedger={loadLedger} />);
    fireEvent.click(screen.getByRole('button', { name: t('verify.room.button') }));
    expect(await screen.findByText(t('chain.broken', { n: 2 }))).toBeTruthy();
  });

  it.each([
    ['notYet', 'verify.room.notYet'],
    ['denied', 'verify.room.denied'],
    ['failed', 'verify.room.failed'],
  ] as const)('explains a %s answer', async (kind, key) => {
    const loadLedger = (): Promise<LedgerFetch> => Promise.resolve({ kind });
    render(<VerifyPanel room={ROOM} apiBase="https://api.example.test" loadLedger={loadLedger} />);
    fireEvent.click(screen.getByRole('button', { name: t('verify.room.button') }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t(key)));
  });

  it('turns the room button off when there is no room or no server', () => {
    const { rerender } = render(<VerifyPanel room={null} apiBase="https://api.example.test" />);
    const button = (): HTMLElement => screen.getByRole('button', { name: t('verify.room.button') });
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('verify.room.none'))).toBeTruthy();
    rerender(<VerifyPanel room={ROOM} />);
    expect(button().getAttribute('aria-disabled')).toBe('true');
  });
});

describe('/verify route', () => {
  it('is a page of its own with the verify area', () => {
    render(<App initialPath="/verify" />);
    expect(screen.getByRole('heading', { level: 1, name: t('verify.page.title') })).toBeTruthy();
    expect(screen.getByTestId('verify-panel')).toBeTruthy();
    expect(document.title).toBe(t('verify.page.title'));
  });

  it('offers the room this tab holds', () => {
    rememberHubKeys('room-9', {
      auctioneer: 'a',
      screen: 's',
      expiresAt: null,
      code: 'ABC234',
      reviewer: 'rev',
    });
    render(<VerifyScreen apiBase="https://api.example.test" />);
    const button = screen.getByRole('button', { name: t('verify.room.button') });
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByRole('link', { name: t('verify.audit') }).getAttribute('href')).toBe(
      '/r/room-9/audit#token=rev',
    );
  });

  it('offers the room after a full page load from the hub link (#2447)', () => {
    // A plain link to /verify empties memory; only this tab's sessionStorage still holds the keys.
    sessionStorage.setItem(
      'gavel:session:room-10:hub',
      JSON.stringify({
        auctioneer: 'a',
        screen: 's',
        expiresAt: null,
        code: 'ABC234',
        reviewer: 'rev',
      }),
    );
    try {
      render(<VerifyScreen apiBase="https://api.example.test" />);
      const button = screen.getByRole('button', { name: t('verify.room.button') });
      expect(button.getAttribute('aria-disabled')).not.toBe('true');
    } finally {
      sessionStorage.removeItem('gavel:session:room-10:hub');
    }
  });
});
