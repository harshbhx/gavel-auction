import { render, waitFor } from '@testing-library/react';
import type { GridApi } from 'ag-grid-community';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import BidsGrid from '../../src/grid/BidsGrid';
import type { BidStreamRow } from '../../src/screens/console/BidStream';
import { stubResizeObserver } from '../support/gridTest';

beforeAll(stubResizeObserver);

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
