import type { GridApi, ProcessCellForExportParams } from 'ag-grid-community';
import { useId, useRef, useState, type ReactNode } from 'react';

import { t } from '../copy/t';
import { Button } from '../design/primitives/Button';
import { forgetColumns } from './columnMemory';
import { exportStamp } from './exportName';

export interface SortOption {
  colId: string;
  label: string;
}

export interface GridToolbarProps {
  api: GridApi | null;
  quickLabel: string;
  quickHint: string;
  shown: number;
  total: number;
  /** File name without time or extension (see exportBaseName); the export adds the time and `.csv`. */
  fileName: string;
  /** Key of the remembered column layout, so Reset can forget it. */
  memoryKey?: string | null;
  /** Called with the search text whenever it changes (the ledger writes it to the URL). */
  onQuickChange?: (text: string) => void;
  /** Starting text of the search box. */
  initialQuick?: string;
  /** Replaces the default count line ("{shown} of {total} entries"). */
  count?: string;
  /** Called after Reset has cleared the grid. */
  onReset?: () => void;
  /** Column ids written to the CSV, in order. */
  exportKeys: readonly string[];
  /** How a cell is written to the CSV. Return undefined to use the formatted cell text. */
  processCell?: (colId: string, rowData: unknown) => string | undefined;
  selectedCount?: number;
  /** Narrow screens have no header row to click, so they sort with a select. */
  sortOptions?: readonly SortOption[];
  /** Extra controls, rendered at the end of the toolbar. */
  children?: ReactNode;
}

const FORMULA_START = /^[\t\r =+\-@]/;

/** A CSV cell that a spreadsheet cannot take for a formula. */
export function safeCell(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Search, sort (narrow), export, copy and reset: the controls every grid here shares. */
export function GridToolbar({
  api,
  quickLabel,
  quickHint,
  shown,
  total,
  fileName,
  exportKeys,
  processCell,
  selectedCount = 0,
  sortOptions,
  memoryKey = null,
  onQuickChange,
  initialQuick = '',
  count,
  onReset,
  children,
}: GridToolbarProps) {
  const inputId = useId();
  const sortId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const csvParams = (name: string) => ({
    columnKeys: [...exportKeys],
    onlySelected: selectedCount > 0,
    skipPinnedBottom: true,
    fileName: name,
    processCellCallback: (p: ProcessCellForExportParams): string => {
      const custom = processCell?.(p.column.getColId(), p.node?.data);
      return safeCell(custom ?? p.formatValue(p.value));
    },
  });

  // Export what is on screen: the rows that pass the filters, in the order shown (selected rows only
  // when some are selected). The file name carries the room and the time of the export.
  const exportCsv = (): void => {
    if (api === null) return;
    const name = `${fileName}-${exportStamp()}`;
    api.exportDataAsCsv(csvParams(name));
    setNotice(t('grid.export.done', { file: name, n: selectedCount > 0 ? selectedCount : shown }));
  };

  const copyCsv = (): void => {
    const csv = api?.getDataAsCsv(csvParams(fileName));
    if (csv === undefined) return;
    navigator.clipboard.writeText(csv).then(
      () => {
        setNotice(t('ledger.copied'));
      },
      () => {
        setNotice(t('ledger.copyFailed'));
      },
    );
  };

  const reset = (): void => {
    if (api === null) return;
    api.resetColumnState();
    api.setFilterModel(null);
    api.setGridOption('quickFilterText', '');
    if (input.current !== null) input.current.value = '';
    onQuickChange?.('');
    if (memoryKey !== null) forgetColumns(memoryKey);
    setSortKey('');
    setNotice(null);
    onReset?.();
  };

  const applySort = (colId: string, dir: 'asc' | 'desc'): void => {
    if (api === null) return;
    api.applyColumnState({
      state: colId === '' ? [] : [{ colId, sort: dir }],
      defaultState: { sort: null },
    });
  };

  return (
    <div className="gv-gridbar">
      <div className="gv-gridbar__search">
        <label htmlFor={inputId}>{quickLabel}</label>
        <input
          id={inputId}
          ref={input}
          type="search"
          placeholder={quickHint}
          autoComplete="off"
          defaultValue={initialQuick}
          onChange={(e) => {
            api?.setGridOption('quickFilterText', e.currentTarget.value);
            onQuickChange?.(e.currentTarget.value);
          }}
        />
      </div>
      {sortOptions !== undefined && (
        <div className="gv-gridbar__sort">
          <label htmlFor={sortId}>{t('grid.sort')}</label>
          <select
            id={sortId}
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.currentTarget.value);
              applySort(e.currentTarget.value, sortDir);
            }}
          >
            <option value="" />
            {sortOptions.map((o) => (
              <option key={o.colId} value={o.colId}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t('grid.sortDir')}
            value={sortDir}
            onChange={(e) => {
              const dir = e.currentTarget.value === 'desc' ? 'desc' : 'asc';
              setSortDir(dir);
              applySort(sortKey, dir);
            }}
          >
            <option value="asc">{t('grid.sortAsc')}</option>
            <option value="desc">{t('grid.sortDesc')}</option>
          </select>
        </div>
      )}
      <p className="gv-gridbar__count" role="status">
        {count ?? t('ledger.count', { shown, total })}
      </p>
      <div className="gv-gridbar__actions">
        <Button variant="outline" tone="neutral" onClick={exportCsv}>
          {selectedCount > 0
            ? t('ledger.exportSelected', { n: selectedCount })
            : shown === 1
              ? t('grid.export.shownOne')
              : t('grid.export.shown', { n: shown })}
        </Button>
        <Button variant="outline" tone="neutral" onClick={copyCsv}>
          {t('ledger.copy')}
        </Button>
        <Button variant="outline" tone="neutral" onClick={reset}>
          {t('ledger.reset')}
        </Button>
        {children}
      </div>
      {notice !== null && (
        <p className="gv-gridbar__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
