import type { ColumnSizeState, ColumnState, GridApi, GridState } from 'ag-grid-community';

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
 * Grid event props that keep the saved layout up to date. Spread them onto the grid; `key` names
 * the grid and its layout (null: remember nothing). The saved layout comes back through
 * `initialState` (see gridStateFor), so there is no flash of the default order.
 */
export function columnMemoryProps(key: string | null): {
  onSortChanged: (e: { api: GridApi }) => void;
  onColumnMoved: (e: { api: GridApi }) => void;
  onColumnResized: (e: { api: GridApi; finished: boolean }) => void;
  onStateUpdated: (e: { api: GridApi }) => void;
} {
  const save = (e: { api: GridApi }): void => {
    if (key !== null) saveColumns(key, e.api);
  };
  return {
    onSortChanged: save,
    onColumnMoved: save,
    onColumnResized: (e) => {
      if (e.finished) save(e);
    },
    onStateUpdated: save,
  };
}

/**
 * Puts the saved sort back when the grid is ready. `initialState` carries the whole layout; this
 * covers the sort in case the grid applied a column's own default sort after reading it.
 */
export function restoreSort(api: GridApi, key: string | null): void {
  const saved = key === null ? null : loadColumns(key);
  if (saved === null) return;
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
}
