import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditRoute } from '../../src/App';
import { roomStore } from '../../src/store/roomStore';
import {
  auctionId,
  bidId,
  bidderId,
  openSnapshot,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import type { AuditPayload } from '../../src/wire';

function row(seq: number, paddle: number): AuditPayload {
  return {
    bidId: bidId(seq),
    bidderId: bidderId(paddle),
    source: 'manual',
    outcome: 'accepted',
    serverTs: 1_700_000_000_000 + seq,
    seq,
  } as AuditPayload;
}

let seq = 0;

function load(rows: AuditPayload[]): void {
  const snap = { ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])), recentAudit: rows };
  act(() => {
    roomStore.enter(auctionId());
    roomStore.dispatch({ kind: 'wire', msg: stateMsg(++seq, snap) });
  });
}

describe('audit route mounts filters and export', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/audit');
  });

  it('shows the loading state before the room has loaded', () => {
    roomStore.enter(auctionId(9));
    render(<AuditRoute />);
    expect(screen.getByRole('status', { busy: true })).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('shows the filters and the export buttons once rows exist', () => {
    load([row(2, 1), row(3, 2)]);
    render(<AuditRoute />);
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByText('CSV, full trail')).toBeTruthy();
    expect(screen.getByText('JSON, filtered rows')).toBeTruthy();
  });

  it('reads the paddle filter from the address bar', () => {
    window.history.replaceState(null, '', '/audit?paddle=2');
    load([row(2, 1), row(3, 2)]);
    render(<AuditRoute />);
    const input = screen.getByLabelText('Paddle');
    expect((input as HTMLInputElement).value).toBe('2');
  });
});
