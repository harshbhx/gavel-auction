import type { ColumnSizeState, ColumnState, GridApi, GridState } from 'ag-grid-community';
import { useEffect } from 'react';

const PREFIX = 'gavel.grid.columns.';

/** What is remembered for one column: where it sits, how wide it is and how it sorts. */
export interface SavedColumn {
  colId: string;
  width?: number;
  flex?: number;
  sort?: 'asc' | 'desc' | null;
  sortIndex?: number | null;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isSaved(v: unknown): v is SavedColumn {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): boolean => x === undefined || (typeof x === 'number' && x > 0);
  return (
    typeof o.colId === 'string' &&
    num(o.width) &&
    num(o.flex) &&
    (o.sort === undefined || o.sort === null || o.sort === 'asc' || o.sort === 'desc') &&
    (o.sortIndex === undefined || o.sortIndex === null || typeof o.sortIndex === 'number')
  );
}

/** The saved columns for one grid, or null when nothing (or nothing usable) is stored. */
export function loadColumns(key: string): SavedColumn[] | null {
  try {
    const raw = store()?.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isSaved)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function forgetColumns(key: string): void {
  try {
    store()?.removeItem(PREFIX + key);
  } catch {
    // Storage can be blocked; the grid works without it.
  }
}

/** Order is the array order. Hidden state is not remembered: the layout decides what shows. */
export function toSaved(state: readonly ColumnState[]): SavedColumn[] {
  return state.map((c) => {
    const out: SavedColumn = { colId: c.colId };
    if (typeof c.flex === 'number' && c.flex > 0) out.flex = c.flex;
    else if (typeof c.width === 'number' && c.width > 0) out.width = Math.round(c.width);
    out.sort = c.sort ?? null;
    out.sortIndex = c.sortIndex ?? null;
    return out;
  });
}

export function saveColumns(key: string, api: GridApi): void {
  try {
    store()?.setItem(PREFIX + key, JSON.stringify(toSaved(api.getColumnState())));
  } catch {
    // Storage can be blocked or full; nothing to do.
  }
}

/**
 * The saved layout as AG Grid state, for the `initialState` grid option: the grid is created with it,
 * so there is no flash of the default order. Null when nothing is saved.
 */
export function gridStateFor(key: string | null): GridState | undefined {
  const saved = key === null ? null : loadColumns(key);
  if (saved === null || saved.length === 0) return undefined;
  const sorted = saved
    .filter((c) => c.sort === 'asc' || c.sort === 'desc')
    .sort((x, y) => (x.sortIndex ?? 0) - (y.sortIndex ?? 0));
  return {
    columnOrder: { orderedColIds: saved.map((c) => c.colId) },
    columnSizing: {
      columnSizingModel: saved.flatMap((c): ColumnSizeState[] =>
        c.flex !== undefined
          ? [{ colId: c.colId, flex: c.flex }]
          : c.width !== undefined
            ? [{ colId: c.colId, width: c.width }]
            : [],
      ),
    },
    sort: {
      sortModel: sorted.map((c) => ({ colId: c.colId, sort: c.sort === 'desc' ? 'desc' : 'asc' })),
    },
  };
}

/**
 * Remembers sort, column order and widths of one grid for the rest of the browser session
 * (sessionStorage, so it is gone when the tab closes). `key` names the grid and its layout. The grid
 * gets the saved layout through `initialState` (see gridStateFor); this hook keeps it up to date.
 */
export function useColumnMemory(api: GridApi | null, key: string | null): void {
  useEffect(() => {
    if (api === null || key === null) return undefined;
    // The layout also goes in through initialState; this puts the sort back once the grid has settled,
    // in case the grid applied its own default sort after creating the columns.
    const saved = loadColumns(key);
    const settle = window.setTimeout(() => {
      if (saved === null || api.isDestroyed()) return;
      const known = saved.filter((c) => api.getColumn(c.colId) !== null);
      if (!known.some((c) => c.sort === 'asc' || c.sort === 'desc')) return;
      api.applyColumnState({
        state: known.map((c) => ({
          colId: c.colId,
          sort: c.sort ?? null,
          sortIndex: c.sortIndex ?? null,
        })),
        defaultState: { sort: null },
      });
    }, 0);
    const save = (): void => {
      saveColumns(key, api);
    };
    const onResize = (e: { finished?: boolean }): void => {
      if (e.finished !== false) save();
    };
    api.addEventListener('sortChanged', save);
    api.addEventListener('columnMoved', save);
    api.addEventListener('columnResized', onResize);
    return () => {
      window.clearTimeout(settle);
      if (!api.isDestroyed()) {
        api.removeEventListener('sortChanged', save);
        api.removeEventListener('columnMoved', save);
        api.removeEventListener('columnResized', onResize);
      }
    };
  }, [api, key]);
}
