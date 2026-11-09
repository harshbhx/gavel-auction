import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GridApi } from 'ag-grid-community';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerRow } from '../../src/grid/cells';
import LedgerGrid from '../../src/grid/LedgerGrid';
import { sealChain, type LedgerEntry } from '../../src/grid/ledgerModel';
import { nodeHash, stubResizeObserver } from '../support/gridTest';

beforeAll(stubResizeObserver);

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

interface Opts {
  edit?: (chain: LedgerEntry[]) => LedgerEntry[];
  urlState?: boolean;
  remember?: boolean;
  roomId?: string;
}

async function mount(opts: Opts = {}) {
  const chain = (opts.edit ?? ((c) => c))(await sealChain(bodies, nodeHash));
  let api: GridApi<LedgerRow> | null = null;
  const props = {
    entries: chain,
    hash: nodeHash,
    narrow: false,
    virtualise: false,
    remember: opts.remember ?? false,
    ...(opts.urlState === undefined ? {} : { urlState: opts.urlState }),
    ...(opts.roomId === undefined ? {} : { roomId: opts.roomId }),
    onReady: (a: GridApi<LedgerRow>) => {
      api = a;
    },
  };
  const view = render(<LedgerGrid {...props} />);
  await waitFor(() => {
    expect(api).not.toBeNull();
  });
  const grid = api as unknown as GridApi<LedgerRow>;
  await waitFor(() => {
    expect(grid.getDisplayedRowCount()).toBe(5);
  });
  return { api: grid, view, chain, props };
}

function filters() {
  return within(screen.getByRole('search', { name: 'Filter the ledger' }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/ledger');
});

describe('LedgerGrid export of what you see', () => {
  it('says how many rows it will write and names the room and the time in the file', async () => {
    const { api } = await mount({ roomId: 'room-abc' });
    const spy = vi.spyOn(api, 'exportDataAsCsv').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Export what you see (5 rows)' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const params = spy.mock.calls[0]?.[0];
    expect(String(params?.fileName)).toMatch(/^gavel-ledger-room-abc-\d{8}T\d{6}Z$/);
    expect(params?.onlySelected).toBe(false);
    expect(
      await screen.findByText(/^Saved gavel-ledger-room-abc-\d{8}T\d{6}Z\.csv\. Rows written: 5,/),
    ).toBeTruthy();
  });

  it('follows the filters: the button and the file count match the rows on screen', async () => {
    const { api } = await mount();
    const spy = vi.spyOn(api, 'exportDataAsCsv').mockImplementation(() => undefined);
    fireEvent.change(screen.getByLabelText('Search the ledger'), { target: { value: 'hammer' } });
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(1);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Export what you see (1 row)' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Rows written: 1,/)).toBeTruthy();
  });
});

describe('LedgerGrid filters', () => {
  it('filters by event, paddle and hash prefix, and writes them to the URL', async () => {
    const { api, chain } = await mount({ urlState: true });

    fireEvent.change(filters().getByLabelText('Event'), { target: { value: 'Hammer' } });
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(1);
    });
    expect(new URLSearchParams(window.location.search).get('gf')).toContain('Hammer');

    fireEvent.change(filters().getByLabelText('Event'), { target: { value: '' } });
    fireEvent.change(filters().getByLabelText('Paddle'), { target: { value: '1' } });
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(2);
    });

    fireEvent.change(filters().getByLabelText('Paddle'), { target: { value: '' } });
    const prefix = (chain[2]?.hash ?? '').slice(0, 8);
    fireEvent.change(filters().getByLabelText('Hash starts with'), { target: { value: prefix } });
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(1);
    });
    expect(api.getDisplayedRowAtIndex(0)?.data?.seq).toBe(3);
  });

  it('puts the search text in the URL and clears it on reset', async () => {
    const { api } = await mount({ urlState: true });
    fireEvent.change(screen.getByLabelText('Search the ledger'), { target: { value: 'hammer' } });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('gq')).toBe('hammer');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset columns and filters' }));
    await waitFor(() => {
      expect(window.location.search).toBe('');
      expect(api.getDisplayedRowCount()).toBe(5);
    });
  });

  it('opens a shared link with its filters applied', async () => {
    const q = encodeURIComponent(
      JSON.stringify({ type: { filterType: 'text', type: 'equals', filter: 'Hammer' } }),
    );
    window.history.replaceState(null, '', `/ledger?gq=hammer&gf=${q}&other=1`);
    const chain = await sealChain(bodies, nodeHash);
    let api: GridApi<LedgerRow> | null = null;
    render(
      <LedgerGrid
        entries={chain}
        hash={nodeHash}
        narrow={false}
        virtualise={false}
        remember={false}
        urlState
        onReady={(a) => {
          api = a;
        }}
      />,
    );
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    const grid = api as unknown as GridApi<LedgerRow>;
    await waitFor(() => {
      expect(grid.getDisplayedRowCount()).toBe(1);
    });
    expect((screen.getByLabelText('Search the ledger') as HTMLInputElement).value).toBe('hammer');
    expect((filters().getByLabelText('Event') as HTMLSelectElement).value).toBe('Hammer');
    expect(new URLSearchParams(window.location.search).get('other')).toBe('1');
  });

  it('shows the whole ledger for a damaged link', async () => {
    window.history.replaceState(null, '', '/ledger?gf=%7Bbroken');
    const { api } = await mount({ urlState: true });
    expect(api.getDisplayedRowCount()).toBe(5);
  });

  it('leaves the URL alone unless asked', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Search the ledger'), { target: { value: 'hammer' } });
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('button', { name: 'Copy link to this view' })).toBeNull();
  });
});

describe('LedgerGrid remembers its columns for the session', () => {
  it('restores sort and width after a remount, and drops them on reset', async () => {
    const first = await mount({ remember: true });
    act(() => {
      first.api.applyColumnState({
        state: [
          { colId: 'amount', sort: 'desc' },
          { colId: 'type', width: 333 },
        ],
        defaultState: { sort: null },
      });
    });
    await waitFor(() => {
      expect(window.sessionStorage.getItem('gavel.grid.columns.ledger.sealed.table')).toContain(
        '"colId":"amount"',
      );
    });
    first.view.unmount();

    const second = await mount({ remember: true });
    await waitFor(() => {
      expect(second.api.getColumn('type')?.getActualWidth()).toBe(333);
    });
    expect(second.api.getDisplayedRowAtIndex(0)?.data?.amountCents).toBe(100_000);

    fireEvent.click(screen.getByRole('button', { name: 'Reset columns and filters' }));
    await waitFor(() => {
      const kept = window.sessionStorage.getItem('gavel.grid.columns.ledger.sealed.table') ?? '';
      expect(kept).not.toContain('"sort":"desc"');
      expect(kept).not.toContain('333');
    });
  });
});

describe('LedgerGrid verify chain', () => {
  it('recomputes the chain, marks rows one by one and says what it checked', async () => {
    const { view } = await mount();
    expect(screen.getByText(/It checks the public export, not the server copy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await waitFor(() => {
      expect(view.container.querySelectorAll('.gv-grid-row--ok').length).toBeGreaterThan(0);
    });
    expect(
      await screen.findByText(
        'Checked 5 entries in this export: every hash matches and every link holds',
      ),
    ).toBeTruthy();
    expect(view.container.querySelectorAll('.gv-grid-row--ok').length).toBe(5);
    expect(screen.getByRole('button', { name: 'Verify chain again' })).toBeTruthy();
  });

  it('marks the edited entry red and names it instead of calling the chain intact', async () => {
    const { view } = await mount({
      edit: (chain) => chain.map((e) => (e.seq === 3 ? { ...e, amountCents: 999_999 } : e)),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await waitFor(() => {
      expect(view.container.querySelectorAll('.gv-grid-row--ok').length).toBe(4);
    });
    const status = screen.getAllByRole('status').map((n) => n.textContent ?? '');
    expect(status.some((s) => s.includes('Chain broken at entry 3'))).toBe(true);
    expect(view.container.querySelectorAll('.gv-grid-row--bad').length).toBeGreaterThan(0);
    expect(within(view.container).queryByText(/every hash matches/)).toBeNull();
  });

  it('has no verify button for rows that were never sealed', async () => {
    const rows: LedgerEntry[] = (await sealChain(bodies, nodeHash)).map((e) => ({
      ...e,
      hash: null,
      prev: null,
    }));
    render(<LedgerGrid entries={rows} narrow={false} virtualise={false} remember={false} />);
    await screen.findByRole('region', { name: 'Ledger table' });
    expect(screen.queryByRole('button', { name: 'Verify chain' })).toBeNull();
  });
});

describe('LedgerGrid keyboard', () => {
  it('lets Tab leave the table instead of walking every cell', async () => {
    const { api } = await mount();
    const tab = api.getGridOption('tabToNextCell');
    const header = api.getGridOption('tabToNextHeader');
    expect(typeof tab).toBe('function');
    expect(typeof header).toBe('function');
    expect((tab as () => unknown)()).toBe(false);
    expect((header as () => unknown)()).toBe(false);
  });

  it('describes the keys in text a screen reader reads', async () => {
    await mount();
    expect(screen.getByText(/Tab enters the table and Tab again leaves it/)).toBeTruthy();
  });
});
