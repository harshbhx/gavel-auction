import { fireEvent, render, screen, within } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditPage } from '../../src/screens/audit/AuditPage';
import { initialRoomState } from '../../src/store/roomReducer';
import {
  BASE_TIME,
  auctionId,
  bidId,
  bidderId,
  openSnapshot,
  roster,
} from '../../src/testing/builders';
import type { AuditPayload } from '../../src/wire';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function row(seq: number, paddle: number): AuditPayload {
  return {
    bidId: bidId(seq),
    bidderId: bidderId(paddle),
    source: 'manual',
    outcome: 'accepted',
    serverTs: EpochMs(BASE_TIME + seq * 1000),
    seq,
    parsedAmount: Cents(seq * 5000),
  } as AuditPayload;
}

function renderPage(): void {
  const state = {
    ...initialRoomState(auctionId()),
    snapshot: openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
    audit: [row(1, 1), row(2, 2)],
  };
  render(<AuditPage state={state} roomId="x" />);
}

describe('audit detail sheet focus and keyboard', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/r/x/audit');
  });

  it('is a modal dialog with a name, keeps Tab inside, closes on Escape and returns focus', () => {
    renderPage();
    const tl = screen.getByRole('region', { name: 'Timeline' });
    const opener = within(tl).getAllByRole('button', { name: /Entry 2/ })[0] as HTMLElement;
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Entry 2' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
