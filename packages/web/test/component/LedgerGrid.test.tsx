import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GridApi } from 'ag-grid-community';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LedgerRow } from '../../src/grid/cells';
import LedgerGrid from '../../src/grid/LedgerGrid';
import { sealChain, type LedgerEntry } from '../../src/grid/ledgerModel';
import { nodeHash, stubResizeObserver } from '../support/gridTest';

beforeAll(stubResizeObserver);
beforeEach(() => {
  window.sessionStorage.clear();
});

const bodies = [
  {
    at: 1_700_000_001_000,
    type: 'auction_opened',
    actor: 'auctioneer',
    amountCents: null,
    note: null,
  },
  {
    at: 1_700_000_002_000,
    type: 'hold_placed',
    actor: 'paddle:1',
    amountCents: 100_000,
    note: null,
  },
  { at: 1_700_000_003_000, type: 'bid_accepted', actor: 'paddle:1', amountCents: 5000, note: null },
  {
    at: 1_700_000_004_000,
    type: 'bid_rejected',
    actor: 'paddle:2',
    amountCents: 5000,
    note: 'below_increment',
  },
  { at: 1_700_000_005_000, type: 'hammer', actor: 'auctioneer', amountCents: 5000, note: null },
];

async function mount(entriesOf: (chain: LedgerEntry[]) => LedgerEntry[] = (c) => c) {
  const chain = entriesOf(await sealChain(bodies, nodeHash));
  let api: GridApi<LedgerRow> | null = null;
  const view = render(
    <LedgerGrid
      entries={chain}
      hash={nodeHash}
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
  return { api: api as unknown as GridApi<LedgerRow>, view };
}

describe('LedgerGrid', () => {
  it('shows every entry and checks the chain in the browser', async () => {
    const { api } = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
    expect(await screen.findByText('Chain intact: 5 entries sealed and linked')).toBeTruthy();
    expect(api.getRowNode('3')?.data?.status).toBe('verified');
    expect(screen.getByRole('region', { name: 'Ledger table' })).toBeTruthy();
  });

  it('sorts by a column', async () => {
    const { api } = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
    act(() => {
      api.applyColumnState({
        state: [{ colId: 'amount', sort: 'desc' }],
        defaultState: { sort: null },
      });
    });
    const first = api.getDisplayedRowAtIndex(0)?.data;
    expect(first?.amountCents).toBe(100_000);
  });

  it('narrows rows with the search box', async () => {
    const { api } = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
    fireEvent.change(screen.getByLabelText('Search the ledger'), { target: { value: 'hammer' } });
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(1);
    });
  });

  it('filters by a column and resets', async () => {
    const { api } = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
    act(() => {
      api.setFilterModel({ actor: { filterType: 'text', type: 'contains', filter: 'Paddle 1' } });
    });
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(2);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset columns and filters' }));
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
  });

  it('exports the rows as CSV, safe for a spreadsheet', async () => {
    const { api } = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
    const csv = api.getDataAsCsv({ columnKeys: ['seq', 'type', 'amount'] }) ?? '';
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('No.');
    expect(lines).toHaveLength(6);
    expect(lines.some((l) => l.includes('Hammer'))).toBe(true);
  });

  it('pins the number column on the left', async () => {
    const { api } = await mount();
    expect(api.getColumn('seq')?.getPinned()).toBe('left');
  });

  it('opens the whole entry in a detail panel when a row is selected', async () => {
    const { api } = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(5);
    });
    expect(screen.getByText('Select a row to see the whole entry.')).toBeTruthy();
    act(() => {
      api.getRowNode('3')?.setSelected(true);
    });
    expect(await screen.findByRole('heading', { name: 'Entry 3' })).toBeTruthy();
    expect(screen.getByText('Hash (SHA-256)')).toBeTruthy();
  });

  it('highlights a row that was edited after sealing', async () => {
    const { api, view } = await mount((chain) =>
      chain.map((e) => (e.seq === 3 ? { ...e, amountCents: 999_999 } : e)),
    );
    await waitFor(() => {
      expect(api.getRowNode('3')?.data?.status).toBe('tampered');
    });
    expect(await screen.findByText('Chain broken at entry 3')).toBeTruthy();
    await waitFor(() => {
      expect(view.container.querySelectorAll('.gv-grid-row--bad').length).toBeGreaterThan(0);
    });
    expect(api.getRowNode('2')?.data?.status).toBe('verified');
  });

  it('takes chain results from outside and does not hash itself', async () => {
    const chain = await sealChain(bodies, nodeHash);
    let api: GridApi<LedgerRow> | null = null;
    let hashed = 0;
    render(
      <LedgerGrid
        entries={chain}
        verdicts={new Map(chain.map((e) => [e.seq, e.seq === 4 ? 'broken' : 'verified']))}
        hash={(text) => {
          hashed += 1;
          return nodeHash(text);
        }}
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
    expect((api as unknown as GridApi<LedgerRow>).getRowNode('4')?.data?.status).toBe('broken');
    expect(hashed).toBe(0);
  });

  it('shows one card per row on a narrow screen, with a sort control', async () => {
    const chain = await sealChain(bodies, nodeHash);
    let api: GridApi<LedgerRow> | null = null;
    const { container } = render(
      <LedgerGrid
        entries={chain}
        hash={nodeHash}
        narrow
        virtualise={false}
        onReady={(a) => {
          api = a;
        }}
      />,
    );
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    expect(container.querySelector('[data-mode="cards"]')).not.toBeNull();
    await waitFor(() => {
      expect(container.querySelectorAll('.gv-card').length).toBe(5);
    });
    expect(screen.getByLabelText('Sort by')).toBeTruthy();
    expect(screen.getByLabelText('Sort direction')).toBeTruthy();
  });
});
