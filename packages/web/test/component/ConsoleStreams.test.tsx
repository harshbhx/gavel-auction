import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BidderId } from '@gavel/shared';
import { en } from '../../src/copy/en';
import { BidStream, rowsFromAudit, type BidStreamRow } from '../../src/screens/console/BidStream';
import { ConfirmQueue } from '../../src/screens/console/ConfirmQueue';
import { ManualEntry } from '../../src/screens/console/ManualEntry';
import { confirmShortcut } from '../../src/screens/console/shortcuts';
import { VoiceFeed } from '../../src/screens/console/VoiceFeed';
import type { AuditPayload, ConfirmRequestMsg } from '../../src/wire';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function row(seq: number, over: Partial<BidStreamRow> = {}): BidStreamRow {
  return {
    id: `b${seq}`,
    serverTs: 1_700_000_000_000 + seq * 1000,
    seq,
    paddle: 12,
    amountCents: 35_000,
    source: 'manual',
    confidence: null,
    status: 'accepted',
    reason: null,
    ...over,
  };
}

describe('BidStream (R-WEB-065)', () => {
  it('draws fewer than 50 rows for 250 events', () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i + 1));
    const { container } = render(<BidStream rows={rows} />);
    const drawn = container.querySelectorAll('li.gv-stream__row').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(50);
  });

  it('moves the window when scrolled', () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i + 1));
    const { container } = render(<BidStream rows={rows} />);
    const scroll = container.querySelector('.gv-stream__scroll');
    if (scroll === null) throw new Error('scroll area missing');
    fireEvent.scroll(scroll, { target: { scrollTop: 36 * 100 } });
    const times = Array.from(container.querySelectorAll('li.gv-stream__row time'));
    expect(times.length).toBeLessThan(50);
    expect(container.querySelectorAll('li.gv-stream__row').length).toBeGreaterThan(0);
  });

  it('lists newest first with source, confidence, status and the rejection reason', () => {
    const rows = [
      row(1, { source: 'voice', confidence: 0.93 }),
      row(2, { status: 'rejected', reason: 'over_ceiling' }),
      row(3, { status: 'pending', source: 'voice', confidence: 0.5 }),
    ];
    const { container } = render(<BidStream rows={rows} />);
    const items = Array.from(container.querySelectorAll('li.gv-stream__row'));
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual([
      'pending',
      'rejected',
      'accepted',
    ]);
    expect(screen.getByText(en['console.rej.over_ceiling'], { exact: false })).toBeTruthy();
    expect(screen.getByText('93 percent sure')).toBeTruthy();
    expect(screen.getByText(en['console.status.pending'])).toBeTruthy();
  });

  it('shows the empty copy', () => {
    render(<BidStream rows={[]} />);
    expect(screen.getByText(en['console.noBids'])).toBeTruthy();
  });

  it('maps audit records to rows, newest first', () => {
    const audit = [
      { bidId: 'a', bidderId: 'x', source: 'qr', outcome: 'accepted', serverTs: 1000, seq: 1 },
      {
        bidId: 'b',
        bidderId: 'x',
        source: 'manual',
        outcome: 'rejected',
        reason: 'closed',
        serverTs: 2000,
        seq: 2,
      },
    ] as unknown as AuditPayload[];
    const rows = rowsFromAudit(audit, () => 7);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0]?.status).toBe('rejected');
    expect(rows[1]?.paddle).toBe(7);
  });
});

describe('VoiceFeed (R-WEB-066)', () => {
  it('styles partial muted and final normal, with parse and not-a-bid chips', () => {
    const { container } = render(
      <VoiceFeed
        mic="live"
        level={0.4}
        entries={[
          { id: '1', text: 'paddle twelve', final: false, parse: null },
          {
            id: '2',
            text: 'paddle twelve three fifty',
            final: true,
            parse: { bid: { paddle: 12, amountCents: 35_000, confidence: 0.93 } },
          },
          { id: '3', text: 'hello there', final: true, parse: { bid: null } },
        ]}
      />,
    );
    const entries = Array.from(container.querySelectorAll('.gv-voice__entry'));
    expect(entries.map((e) => e.getAttribute('data-final'))).toEqual(['false', 'true', 'true']);
    expect(screen.getByText('paddle 12, $350, 0.93')).toBeTruthy();
    expect(screen.getByText(en['console.notBid'])).toBeTruthy();
    expect(screen.getByText(en['console.mic.live'])).toBeTruthy();
    expect(container.querySelector('meter')?.getAttribute('value')).toBe('0.4');
  });

  it.each([
    ['off', 'console.mic.off'],
    ['requesting', 'console.mic.requesting'],
    ['error', 'console.mic.error'],
    ['denied', 'console.mic.denied'],
  ] as const)('shows mic state %s', (mic, key) => {
    render(<VoiceFeed mic={mic} level={0} entries={[]} />);
    expect(screen.getByText(en[key])).toBeTruthy();
  });
});

function request(id: string, amount: number, expiresAt: number): ConfirmRequestMsg {
  return { v: 1, t: 'confirm_request', confirmId: id, amount, expiresAt } as ConfirmRequestMsg;
}

describe('shortcuts (R-WEB-067)', () => {
  it('maps keys and ignores them while a field has focus', () => {
    expect(confirmShortcut({ key: 'y', target: null })).toBe('confirm');
    expect(confirmShortcut({ key: 'N', target: null })).toBe('reject');
    expect(confirmShortcut({ key: 'j', target: null })).toBe('next');
    expect(confirmShortcut({ key: 'k', target: null })).toBe('previous');
    expect(confirmShortcut({ key: 'x', target: null })).toBeNull();
    expect(confirmShortcut({ key: 'y', ctrlKey: true, target: null })).toBeNull();
    const input = document.createElement('input');
    expect(confirmShortcut({ key: 'y', target: input })).toBeNull();
  });
});

describe('ConfirmQueue (T-WEB-037)', () => {
  it('moves with J and K and answers the selected item once', () => {
    const onAnswer = vi.fn();
    const requests = [request('c1', 10_000, 20_000), request('c2', 20_000, 30_000)];
    render(<ConfirmQueue requests={requests} now={() => 10_000} onAnswer={onAnswer} />);
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'y' });
    fireEvent.keyDown(document, { key: 'y' });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('c2', true);
    fireEvent.keyDown(document, { key: 'k' });
    fireEvent.keyDown(document, { key: 'n' });
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenLastCalledWith('c1', false);
  });

  it('ignores shortcuts while an input has focus', () => {
    const onAnswer = vi.fn();
    render(
      <div>
        <input aria-label="field" />
        <ConfirmQueue
          requests={[request('c1', 10_000, 20_000)]}
          now={() => 0}
          onAnswer={onAnswer}
        />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'y' });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('counts down and drops an item when the parent removes it', () => {
    vi.useFakeTimers();
    let nowMs = 10_000;
    const onAnswer = vi.fn();
    const { rerender } = render(
      <ConfirmQueue
        requests={[request('c1', 10_000, 15_000)]}
        now={() => nowMs}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText('Expires in 5 s')).toBeTruthy();
    nowMs = 12_000;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Expires in 3 s')).toBeTruthy();
    rerender(<ConfirmQueue requests={[]} now={() => nowMs} onAnswer={onAnswer} />);
    expect(screen.getByText(en['console.noConfirm'])).toBeTruthy();
  });
});

describe('ManualEntry (T-WEB-038)', () => {
  const roster = [{ bidderId: 'bidder-12' as BidderId, paddle: 12 }];

  it('sends one manual bid on Enter and shows a rejection beside the field', () => {
    const onSubmit = vi.fn((): 'sent' => 'sent');
    const { rerender } = render(
      <ManualEntry roster={roster} onSubmit={onSubmit} rejection={null} />,
    );
    fireEvent.change(screen.getByLabelText(en['console.manual.paddle']), {
      target: { value: '12' },
    });
    const amount = screen.getByLabelText(en['console.manual.amount']);
    fireEvent.change(amount, { target: { value: '350' } });
    const form = screen.getByRole('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(35_000, 'bidder-12');
    rerender(<ManualEntry roster={roster} onSubmit={onSubmit} rejection="below_increment" />);
    expect(screen.getByText(en['console.rej.below_increment'])).toBeTruthy();
  });

  it('flags an unknown paddle and a missing amount without sending', () => {
    const onSubmit = vi.fn((): 'sent' => 'sent');
    render(<ManualEntry roster={roster} onSubmit={onSubmit} rejection={null} />);
    fireEvent.change(screen.getByLabelText(en['console.manual.paddle']), {
      target: { value: '99' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByText(en['console.manual.badPaddle'])).toBeTruthy();
    fireEvent.change(screen.getByLabelText(en['console.manual.paddle']), {
      target: { value: '12' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByText(en['console.manual.badAmount'])).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
