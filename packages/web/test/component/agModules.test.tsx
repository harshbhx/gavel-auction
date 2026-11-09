import { render, waitFor } from '@testing-library/react';
import type { GridApi } from 'ag-grid-community';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import BidsGrid from '../../src/grid/BidsGrid';
import HoldsGrid from '../../src/grid/HoldsGrid';
import LedgerGrid from '../../src/grid/LedgerGrid';
import { sealChain } from '../../src/grid/ledgerModel';
import { nodeHash, stubResizeObserver } from '../support/gridTest';

beforeAll(stubResizeObserver);
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * agRuntime.ts registers only the AG Grid modules the grids use. A grid feature whose module is
 * missing logs an AG Grid error (#200); this fails the run on any such error, so a new option or
 * API call cannot ship without its module.
 */
function spyOnErrors(): () => string[] {
  const seen: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  });
  return () => seen.filter((line) => line.includes('AG Grid'));
}

describe('registered AG Grid modules', () => {
  it('cover the ledger grid in table and card layout, with the verify and export tools', async () => {
    const agErrors = spyOnErrors();
    const chain = await sealChain(
      [
        { at: 1000, type: 'auction_opened', actor: 'auctioneer', amountCents: null, note: null },
        { at: 2000, type: 'bid_accepted', actor: 'paddle:1', amountCents: 5000, note: null },
      ],
      nodeHash,
    );
    for (const narrow of [false, true]) {
      let api: GridApi | null = null;
      const view = render(
        <LedgerGrid
          entries={chain}
          hash={nodeHash}
          narrow={narrow}
          virtualise={false}
          remember={false}
          onReady={(a) => {
            api = a as unknown as GridApi;
          }}
        />,
      );
      await waitFor(() => {
        expect(api).not.toBeNull();
      });
      const grid = api as unknown as GridApi;
      grid.setFilterModel({ type: { filterType: 'text', type: 'contains', filter: 'bid' } });
      grid.setGridOption('quickFilterText', 'bid');
      grid.getDataAsCsv();
      grid.applyColumnState({ state: [{ colId: 'seq', sort: 'desc' }] });
      grid.resetColumnState();
      view.unmount();
    }
    expect(agErrors()).toEqual([]);
  });

  it('cover the holds grid with its pinned totals row', async () => {
    const agErrors = spyOnErrors();
    let api: GridApi | null = null;
    render(
      <HoldsGrid
        rows={[
          {
            id: 'a',
            ref: 'a1b2',
            paddle: 1,
            state: 'HELD',
            heldCents: 100_000,
            capturedCents: 0,
            releasedCents: 0,
          },
        ]}
        narrow={false}
        virtualise={false}
        remember={false}
        onReady={(a) => {
          api = a as unknown as GridApi;
        }}
      />,
    );
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    expect(agErrors()).toEqual([]);
  });

  it('cover the live bids grid, including its change flash', async () => {
    const agErrors = spyOnErrors();
    let api: GridApi | null = null;
    render(
      <BidsGrid
        rows={[
          {
            id: 'b1',
            serverTs: 1_700_000_001_000,
            seq: 1,
            paddle: 1,
            amountCents: 500,
            source: 'manual',
            confidence: null,
            status: 'accepted',
            reason: null,
          },
        ]}
        narrow={false}
        virtualise={false}
        remember={false}
        onReady={(a) => {
          api = a as unknown as GridApi;
        }}
      />,
    );
    await waitFor(() => {
      expect(api).not.toBeNull();
    });
    expect(agErrors()).toEqual([]);
  });
});
