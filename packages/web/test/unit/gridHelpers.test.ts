import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnState, GridApi } from 'ag-grid-community';
import {
  forgetColumns,
  loadColumns,
  restoreColumns,
  saveColumns,
  toSaved,
} from '../../src/grid/columnMemory';
import { exportBaseName, exportStamp } from '../../src/grid/exportName';
import { readLedgerUrl, withLedgerState, cleanModel } from '../../src/grid/urlState';

describe('export file names', () => {
  it('names the room and the UTC time', () => {
    expect(exportBaseName('ledger', 'ab12cd')).toBe('gavel-ledger-ab12cd');
    expect(exportStamp(new Date('2026-11-09T10:15:30.456Z'))).toBe('20261109T101530Z');
  });

  it('cuts a room id down to safe characters', () => {
    expect(exportBaseName('bids', '../x y/z')).toBe('gavel-bids----x-y-z');
    expect(exportBaseName('holds', '')).toBe('gavel-holds-room');
    expect(exportBaseName('holds', 'a'.repeat(80))).toBe(`gavel-holds-${'a'.repeat(40)}`);
  });
});

describe('column memory', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('keeps order, width and sort, and drops what it cannot use', () => {
    const state: ColumnState[] = [
      { colId: 'b', width: 120.4, sort: 'desc', sortIndex: 0 },
      { colId: 'a', flex: 1, hide: true },
    ];
    expect(toSaved(state)).toEqual([
      { colId: 'b', width: 120, sort: 'desc', sortIndex: 0 },
      { colId: 'a', flex: 1, sort: null, sortIndex: null },
    ]);
  });

  it('saves and loads per grid key, and forgets', () => {
    const api = {
      getColumnState: () => [{ colId: 'seq', width: 90, sort: 'asc', sortIndex: 0 }],
    } as unknown as GridApi;
    saveColumns('ledger.table', api);
    expect(loadColumns('ledger.table')?.[0]?.colId).toBe('seq');
    expect(loadColumns('bids.table')).toBeNull();
    forgetColumns('ledger.table');
    expect(loadColumns('ledger.table')).toBeNull();
  });

  it('ignores a damaged entry', () => {
    window.sessionStorage.setItem('gavel.grid.columns.x', '{"nope":1}');
    expect(loadColumns('x')).toBeNull();
    window.sessionStorage.setItem('gavel.grid.columns.y', '[{"colId":5}]');
    expect(loadColumns('y')).toBeNull();
    window.sessionStorage.setItem('gavel.grid.columns.z', 'not json');
    expect(loadColumns('z')).toBeNull();
  });

  it('puts a layout back, skipping columns the grid no longer has', () => {
    const applyColumnState = vi.fn();
    const api = {
      getColumn: (id: string) => (id === 'gone' ? null : {}),
      applyColumnState,
    } as unknown as GridApi;
    restoreColumns(api, [
      { colId: 'gone', width: 50 },
      { colId: 'amount', width: 200, sort: 'desc', sortIndex: 0 },
    ]);
    expect(applyColumnState).toHaveBeenCalledWith({
      state: [{ colId: 'amount', width: 200, sort: 'desc', sortIndex: 0 }],
      applyOrder: true,
    });
  });
});

describe('ledger filters in the URL', () => {
  const model = { type: { filterType: 'text', type: 'equals', filter: 'Hammer' } };

  it('round-trips the search text and the filter model', () => {
    const search = withLedgerState('?paddle=2', { quick: 'abc', model });
    const params = new URLSearchParams(search);
    expect(params.get('paddle')).toBe('2');
    expect(params.get('gq')).toBe('abc');
    expect(readLedgerUrl(search)).toEqual({ quick: 'abc', model });
  });

  it('removes its keys when empty and leaves the others', () => {
    expect(withLedgerState('?gq=x&paddle=2', { quick: '', model: {} })).toBe('?paddle=2');
    expect(withLedgerState('?gq=x', { quick: '', model: {} })).toBe('');
  });

  it('reads a bad link as no filter', () => {
    expect(readLedgerUrl('?gf=%7Bbroken')).toEqual({ quick: '', model: {} });
    expect(readLedgerUrl('?gf=[1,2]')).toEqual({ quick: '', model: {} });
  });

  it('keeps only known columns whose value is a filter object', () => {
    expect(
      cleanModel({
        type: { filterType: 'text', filter: 'x' },
        evil: { filterType: 'text' },
        hash: 'nope',
        seq: { notAFilter: true },
      }),
    ).toEqual({ type: { filterType: 'text', filter: 'x' } });
  });
});
