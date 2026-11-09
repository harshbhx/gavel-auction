import { render, screen, waitFor } from '@testing-library/react';
import type { GridApi } from 'ag-grid-community';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import HoldsGrid from '../../src/grid/HoldsGrid';
import type { HoldRow } from '../../src/grid/holdsModel';
import { stubResizeObserver } from '../support/gridTest';

beforeAll(stubResizeObserver);
beforeEach(() => {
  window.sessionStorage.clear();
});

const rows: HoldRow[] = [
  {
    id: 'a',
    ref: 'a1b2',
    paddle: 1,
    state: 'CAPTURED',
    heldCents: 100_000,
    capturedCents: 40_000,
    releasedCents: 60_000,
  },
  {
    id: 'b',
    ref: 'c3d4',
    paddle: 2,
    state: 'SETTLED',
    heldCents: 80_000,
    capturedCents: 0,
    releasedCents: 80_000,
  },
  {
    id: 'c',
    ref: 'e5f6',
    paddle: 3,
    state: 'HELD',
    heldCents: 50_000,
    capturedCents: 0,
    releasedCents: 0,
  },
];

async function mount() {
  let api: GridApi<HoldRow> | null = null;
  render(
    <HoldsGrid
      rows={rows}
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
  return api as unknown as GridApi<HoldRow>;
}

describe('HoldsGrid', () => {
  it('lists the holds with a word for every state and a pinned totals row', async () => {
    const api = await mount();
    await waitFor(() => {
      expect(api.getDisplayedRowCount()).toBe(3);
    });
    await waitFor(() => {
      expect(api.getPinnedBottomRowCount()).toBe(1);
    });
    const totals = api.getPinnedBottomRow(0)?.data;
    expect(totals?.heldCents).toBe(230_000);
    expect(totals?.capturedCents).toBe(40_000);
    expect(totals?.releasedCents).toBe(140_000);
    expect(totals?.ref).toBe('Totals for 3 shown');
    expect((await screen.findAllByText('Held')).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Holds and settlement table' })).toBeTruthy();
  });

  it('keeps the totals in step with the filters', async () => {
    const api = await mount();
    await waitFor(() => {
      expect(api.getPinnedBottomRowCount()).toBe(1);
    });
    api.setFilterModel({ state: { filterType: 'text', type: 'contains', filter: 'Released' } });
    await waitFor(() => {
      expect(api.getPinnedBottomRow(0)?.data?.heldCents).toBe(80_000);
    });
    expect(api.getPinnedBottomRow(0)?.data?.ref).toBe('Totals for 1 shown');
  });

  it('says whether settled totals add up', async () => {
    await mount();
    expect(screen.getByText('Totals add up: final amount plus released equals held')).toBeTruthy();
  });
});
