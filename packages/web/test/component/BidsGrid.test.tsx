import { fireEvent, render, waitFor } from '@testing-library/react';
import type { GridApi } from 'ag-grid-community';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import BidsGrid from '../../src/grid/BidsGrid';
import type { BidStreamRow } from '../../src/screens/console/BidStream';
import { stubResizeObserver } from '../support/gridTest';

beforeAll(stubResizeObserver);
beforeEach(() => {
  window.sessionStorage.clear();
});

function bid(seq: number, extra: Partial<BidStreamRow> = {}): BidStreamRow {
  return {
    id: `b${seq}`,
    serverTs: 1_700_000_000_000 + seq * 1000,
    seq,
    paddle: 1 + (seq % 3),
    amountCents: seq * 500,
    source: 'manual',
    confidence: null,
    status: 'accepted',
    reason: null,
    ...extra,
  };
}

describe('BidsGrid', () => {
  it('applies new and changed bids as one transaction and keeps newest first', async () => {
    let api: GridApi<BidStreamRow> | null = null;
    const props = {
      narrow: false,
      virtualise: false,
      onReady: (a: GridApi<BidStreamRow>) => {
        api = a;
        vi.spyOn(a, 'applyTransaction');
      },
    };
    const first = [bid(1), bid(2, { status: 'pending', source: 'voice', confidence: 0.8 }), bid(3)];
    const { rerender } = render(<BidsGrid rows={first} {...props} />);
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    const grid = api as unknown as GridApi<BidStreamRow>;
    await waitFor(() => {
      expect(grid.getDisplayedRowCount()).toBe(3);
    });
    expect(grid.getDisplayedRowAtIndex(0)?.data?.seq).toBe(3);

    rerender(
      <BidsGrid
        rows={[
          bid(1),
          bid(2, { status: 'accepted', source: 'voice', confidence: 0.8 }),
          bid(3),
          bid(4),
        ]}
        {...props}
      />,
    );
    await waitFor(() => {
      expect(grid.getDisplayedRowCount()).toBe(4);
    });
    expect(grid.applyTransaction).toHaveBeenCalledTimes(1);
    const call = vi.mocked(grid.applyTransaction).mock.calls[0]?.[0];
    expect(call?.add?.map((r) => r.seq)).toEqual([4]);
    expect(call?.update?.map((r) => r.seq)).toEqual([2]);
    expect(call?.remove).toEqual([]);
    expect(grid.getDisplayedRowAtIndex(0)?.data?.seq).toBe(4);
    expect(grid.getRowNode('b2-2')?.data?.status).toBe('accepted');
  });

  it('does not touch the grid when a render brings no change', async () => {
    let api: GridApi<BidStreamRow> | null = null;
    const props = {
      narrow: false,
      virtualise: false,
      onReady: (a: GridApi<BidStreamRow>) => {
        api = a;
        vi.spyOn(a, 'applyTransaction');
      },
    };
    const rows = [bid(1), bid(2)];
    const { rerender } = render(<BidsGrid rows={rows} {...props} />);
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    rerender(<BidsGrid rows={[...rows]} {...props} />);
    expect((api as unknown as GridApi<BidStreamRow>).applyTransaction).not.toHaveBeenCalled();
  });
});

describe('BidsGrid export and memory', () => {
  it('exports what is on screen, named for the room and the time', async () => {
    let api: GridApi<BidStreamRow> | null = null;
    const rows = [bid(1), bid(2, { status: 'rejected', reason: 'below_increment' }), bid(3)];
    const { getByRole, getByLabelText, findByText } = render(
      <BidsGrid
        rows={rows}
        roomId="room-xyz"
        narrow={false}
        virtualise={false}
        onReady={(a) => {
          api = a;
        }}
      />,
    );
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    const grid = api as unknown as GridApi<BidStreamRow>;
    const spy = vi.spyOn(grid, 'exportDataAsCsv').mockImplementation(() => undefined);
    await waitFor(() => {
      expect(getByRole('button', { name: 'Export what you see (3 rows)' })).toBeTruthy();
    });
    fireEvent.change(getByLabelText('Search the bids'), { target: { value: 'rejected' } });
    await waitFor(() => {
      expect(grid.getDisplayedRowCount()).toBe(1);
    });
    fireEvent.click(getByRole('button', { name: 'Export what you see (1 row)' }));
    expect(String(spy.mock.calls[0]?.[0]?.fileName)).toMatch(/^gavel-bids-room-xyz-\d{8}T\d{6}Z$/);
    expect(await findByText(/Rows written: 1,/)).toBeTruthy();
    expect(getByRole('region', { name: 'Bid history table' })).toBeTruthy();
  });
});
