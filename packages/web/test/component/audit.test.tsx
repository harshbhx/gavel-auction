import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditTable, formatOffset, sortRows } from '../../src/screens/audit/AuditTable';
import { bidId, bidderId } from '../../src/testing/builders';
import type { AuditPayload } from '../../src/wire';

function row(seq: number, paddle: number, outcome: AuditPayload['outcome']): AuditPayload {
  return {
    bidId: bidId(seq),
    bidderId: bidderId(paddle),
    source: 'manual',
    outcome,
    serverTs: 1_700_000_000_000 + seq,
    seq,
    parsedAmount: seq * 5000,
  } as AuditPayload;
}

const ROWS = [row(1, 12, 'accepted'), row(2, 7, 'rejected'), row(3, 12, 'accepted')];
const paddleOf = (id: string): number | null => (id === bidderId(12) ? 12 : 7);

describe('AuditTable (T-WEB-042)', () => {
  it('formats the audio offset as mm:ss.mmm', () => {
    expect(formatOffset(65_432)).toBe('01:05.432');
  });

  it('sorts descending and ascending', () => {
    expect(sortRows(ROWS, 'seq', 'descending', paddleOf).map((r) => r.seq)).toEqual([3, 2, 1]);
    expect(sortRows(ROWS, 'paddle', 'ascending', paddleOf).map((r) => r.seq)).toEqual([2, 1, 3]);
  });

  it('is a real table with scope headers and aria-sort that toggles', () => {
    render(<AuditTable rows={ROWS} paddleOf={paddleOf} />);
    expect(screen.getByRole('table')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBe(10);
    expect(headers.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
    const seq = headers[0] as HTMLElement;
    expect(seq.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(seq).getByRole('button'));
    expect(seq.getAttribute('aria-sort')).toBe('descending');
    expect(headers[1]?.getAttribute('aria-sort')).toBe('none');
  });

  it('opens the raw JSON for a row', () => {
    render(<AuditTable rows={ROWS} paddleOf={paddleOf} />);
    const body = screen.getAllByRole('rowgroup')[1] as HTMLElement;
    fireEvent.click(within(body).getAllByRole('button')[0] as HTMLElement);
    const json = screen.getByTestId('audit-json').textContent ?? '';
    expect(JSON.parse(json)).toMatchObject({ seq: 1, outcome: 'accepted' });
  });

  it('appends live rows and works read-only for settled rooms', () => {
    const { rerender } = render(<AuditTable rows={ROWS} paddleOf={paddleOf} live={false} />);
    expect(screen.getAllByRole('row').length).toBe(4);
    rerender(<AuditTable rows={[...ROWS, row(4, 7, 'accepted')]} paddleOf={paddleOf} live />);
    expect(screen.getAllByRole('row').length).toBe(5);
  });
});
