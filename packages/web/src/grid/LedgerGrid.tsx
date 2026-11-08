import type {
  CellKeyDownEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
  RowClassParams,
} from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '../copy/t';
import { Button } from '../design/primitives/Button';
import { sha256Hex } from '../util/hash';
import { formatUsd } from '../util/money';
import { AgGridReact } from './agRuntime';
import { cardCell, statusCell, typeCell, type LedgerRow } from './cells';
import { GridToolbar, type SortOption } from './GridToolbar';
import { actorLabel, typeLabel } from './labels';
import {
  GENESIS_PREV,
  chainCounts,
  firstBad,
  formatStamp,
  shortHash,
  verifyEntries,
  type ChainStatus,
  type HashFn,
  type LedgerEntry,
} from './ledgerModel';
import { gavelTheme } from './theme';
import { useNarrow, useReducedMotion } from './useGridEnv';
import './grid.css';

export interface LedgerGridProps {
  entries: readonly LedgerEntry[];
  /**
   * Chain results computed elsewhere, for example by the replay verifier. Absent: the grid recomputes
   * every hash in the browser. A seq missing from the map shows as checking.
   */
  verdicts?: ReadonlyMap<number, ChainStatus>;
  /** Hash function for the in-browser check. Default: WebCrypto SHA-256. */
  hash?: HashFn;
  /** Height in px. Default: 70% of the viewport, between 22rem and 40rem. */
  height?: number;
  /** Force the narrow card layout on or off. Default: under 700px wide. */
  narrow?: boolean;
  /** Turn row and column virtualisation off. For tests, where there is no layout. */
  virtualise?: boolean;
  /** Called once the grid is ready, with its API (tests and the lab page use it). */
  onReady?: (api: GridApi<LedgerRow>) => void;
  /** Called after each in-browser check. */
  onChecked?: (statuses: ReadonlyMap<number, ChainStatus>) => void;
  fileName?: string;
  /** Called with the seq of the entry a visitor selects (a click or Enter on a row). */
  onOpenEntry?: (seq: number) => void;
  /** Show the built-in detail panel under the grid. Default true; a page with its own sheet turns it off. */
  detail?: boolean;
  /** Accessible name of the table region. */
  label?: string;
}

const EXPORT_KEYS = ['seq', 'at', 'type', 'actor', 'amount', 'hash', 'prev', 'status', 'note'];

function exportCell(colId: string, data: unknown): string | undefined {
  const row = data as LedgerRow | undefined;
  if (row === undefined) return undefined;
  switch (colId) {
    case 'at':
      return new Date(row.at).toISOString();
    case 'hash':
      return row.hash ?? '';
    case 'prev':
      return row.prev ?? '';
    case 'amount':
      return row.amountCents === null ? '' : formatUsd(row.amountCents);
    default:
      return undefined;
  }
}

function useChain(
  entries: readonly LedgerEntry[],
  verdicts: ReadonlyMap<number, ChainStatus> | undefined,
  hash: HashFn,
  onChecked: LedgerGridProps['onChecked'],
): ReadonlyMap<number, ChainStatus> | null {
  const [computed, setComputed] = useState<ReadonlyMap<number, ChainStatus> | null>(null);
  const sealed = entries.some((e) => e.hash !== null);
  useEffect(() => {
    // Unsealed rows (audit rows) have nothing to hash; outside verdicts are used as given.
    if (verdicts !== undefined || !sealed) return undefined;
    let live = true;
    setComputed(null);
    verifyEntries(entries, hash).then(
      (result) => {
        if (!live) return;
        setComputed(result);
        onChecked?.(result);
      },
      () => {
        if (live) setComputed(new Map());
      },
    );
    return () => {
      live = false;
    };
    // onChecked is a callback for the parent; a new function must not re-run the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, verdicts, hash, sealed]);
  return verdicts ?? computed;
}

/**
 * The hash-chained ledger as an AG Grid table: pinned number column, sorting, a search box, column
 * filters, resize and reorder, row selection with a detail panel, CSV export and copy, keyboard
 * navigation, and a status chip for every row. A row that was edited after sealing is highlighted.
 * Under 700px each row becomes a card, so the page never scrolls sideways.
 */
export default function LedgerGrid({
  entries,
  verdicts,
  hash = sha256Hex,
  height,
  narrow: narrowProp,
  virtualise = true,
  onReady,
  onChecked,
  fileName = 'ledger',
  onOpenEntry,
  detail: showDetail = true,
  label,
}: LedgerGridProps) {
  const narrow = useNarrow(narrowProp);
  const calm = useReducedMotion();
  const [api, setApi] = useState<GridApi<LedgerRow> | null>(null);
  const [shown, setShown] = useState(entries.length);
  const [selected, setSelected] = useState<LedgerRow[]>([]);
  const statuses = useChain(entries, verdicts, hash, onChecked);

  const rows = useMemo<LedgerRow[]>(
    () =>
      entries.map((e) => ({
        ...e,
        status: e.hash === null ? 'unsealed' : (statuses?.get(e.seq) ?? 'checking'),
      })),
    [entries, statuses],
  );
  const hasHash = useMemo(() => entries.some((e) => e.hash !== null), [entries]);
  const hasActor = useMemo(() => entries.some((e) => e.actor !== null), [entries]);
  const hasNote = useMemo(() => entries.some((e) => e.note !== null), [entries]);

  const columns = useMemo<ColDef<LedgerRow>[]>(() => {
    const data: ColDef<LedgerRow>[] = [
      {
        colId: 'seq',
        headerName: t('ledger.col.seq'),
        field: 'seq',
        pinned: 'left',
        width: 96,
        filter: 'agNumberColumnFilter',
        cellClass: 'gv-grid-num',
        initialSort: 'asc',
      },
      {
        colId: 'at',
        headerName: t('ledger.col.at'),
        field: 'at',
        width: 190,
        valueFormatter: (p) => (typeof p.value === 'number' ? formatStamp(p.value) : ''),
        filter: 'agNumberColumnFilter',
        cellClass: 'gv-grid-num',
      },
      {
        colId: 'type',
        headerName: t('ledger.col.type'),
        valueGetter: (p) => (p.data === undefined ? '' : typeLabel(p.data.type)),
        cellRenderer: typeCell,
        width: 190,
        filter: 'agTextColumnFilter',
      },
      {
        colId: 'actor',
        headerName: t('ledger.col.actor'),
        valueGetter: (p) => (p.data === undefined ? '' : actorLabel(p.data.actor)),
        width: 150,
        filter: 'agTextColumnFilter',
        hide: !hasActor,
      },
      {
        colId: 'amount',
        headerName: t('ledger.col.amount'),
        field: 'amountCents',
        type: 'rightAligned',
        width: 140,
        valueFormatter: (p) => (typeof p.value === 'number' ? formatUsd(p.value) : ''),
        filter: 'agNumberColumnFilter',
        cellClass: 'gv-grid-num',
      },
      {
        colId: 'hash',
        headerName: t('ledger.col.hash'),
        valueGetter: (p) => shortHash(p.data?.hash ?? null),
        getQuickFilterText: (p) => p.data?.hash ?? '',
        tooltipValueGetter: (p) => p.data?.hash ?? '',
        width: 150,
        cellClass: 'gv-grid-num',
        hide: !hasHash,
      },
      {
        colId: 'prev',
        headerName: t('ledger.col.prev'),
        valueGetter: (p) =>
          p.data?.prev === GENESIS_PREV ? t('ledger.genesis') : shortHash(p.data?.prev ?? null),
        getQuickFilterText: (p) => p.data?.prev ?? '',
        tooltipValueGetter: (p) => p.data?.prev ?? '',
        width: 150,
        cellClass: 'gv-grid-num',
        hide: !hasHash,
      },
      {
        colId: 'note',
        headerName: t('ledger.col.note'),
        field: 'note',
        flex: 1,
        minWidth: 120,
        filter: 'agTextColumnFilter',
        hide: !hasNote,
      },
      {
        colId: 'status',
        headerName: t('ledger.col.status'),
        valueGetter: (p) => p.data?.status ?? '',
        cellRenderer: statusCell,
        width: 210,
        pinned: 'right',
        filter: 'agTextColumnFilter',
      },
    ];
    if (!narrow) return data;
    // Narrow: one card column; the real columns stay (hidden) so sorting, search and export still work.
    return [
      {
        colId: 'card',
        headerName: t('ledger.col.card'),
        flex: 1,
        sortable: false,
        suppressMovable: true,
        resizable: false,
        cellRenderer: cardCell,
        getQuickFilterText: () => '',
      },
      ...data.map((c) => ({ ...c, hide: true, pinned: null })),
    ];
  }, [narrow, hasActor, hasHash, hasNote]);

  const defaultColDef = useMemo<ColDef<LedgerRow>>(
    () => ({ sortable: true, resizable: true, filter: false, suppressMovable: false }),
    [],
  );

  const getRowClass = useCallback((p: RowClassParams<LedgerRow>): string | undefined => {
    const s = p.data?.status;
    return s === 'tampered' || s === 'broken' ? 'gv-grid-row--bad' : undefined;
  }, []);

  const onReadyCb = useCallback(
    (e: GridReadyEvent<LedgerRow>) => {
      setApi(e.api);
      onReady?.(e.api);
    },
    [onReady],
  );

  const sortOptions = useMemo<SortOption[]>(
    () => [
      { colId: 'seq', label: t('ledger.col.seq') },
      { colId: 'at', label: t('ledger.col.at') },
      { colId: 'type', label: t('ledger.col.type') },
      { colId: 'amount', label: t('ledger.col.amount') },
      { colId: 'status', label: t('ledger.col.status') },
    ],
    [],
  );

  const detail = selected.length === 0 ? null : (selected[selected.length - 1] ?? null);
  const counts = useMemo(() => chainCounts(statuses ?? new Map()), [statuses]);
  const bad = statuses === null ? null : firstBad(statuses);

  return (
    <section className="gv-gridwrap" aria-label={label ?? t('ledger.region')}>
      <GridToolbar
        api={api as GridApi | null}
        quickLabel={t('ledger.quick')}
        quickHint={t('ledger.quickHint')}
        shown={shown}
        total={entries.length}
        fileName={fileName}
        exportKeys={EXPORT_KEYS.filter((k) => (k !== 'hash' && k !== 'prev') || hasHash)}
        processCell={exportCell}
        selectedCount={selected.length}
        {...(narrow ? { sortOptions } : {})}
      />
      {statuses === null && hasHash && (
        <p className="gv-gridchain" data-state="checking" role="status">
          {t('ledger.chain.checking', { n: entries.length })}
        </p>
      )}
      {statuses !== null && counts.verified + counts.tampered + counts.broken > 0 && (
        <p className="gv-gridchain" data-state={bad === null ? 'ok' : 'bad'} role="status">
          {bad === null
            ? t('ledger.chain.ok', { n: counts.verified })
            : t('ledger.chain.bad', { n: bad })}
        </p>
      )}
      <div
        className="gv-gridbox"
        data-testid="ledger-grid"
        data-mode={narrow ? 'cards' : 'table'}
        style={height === undefined ? undefined : { height }}
      >
        <AgGridReact<LedgerRow>
          key={narrow ? 'cards' : 'table'}
          theme={gavelTheme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          getRowId={(p) => String(p.data.seq)}
          getRowClass={getRowClass}
          rowSelection={{
            mode: 'multiRow',
            checkboxes: !narrow,
            headerCheckbox: !narrow,
            enableClickSelection: true,
          }}
          {...(narrow ? { rowHeight: 104, headerHeight: 0 } : {})}
          includeHiddenColumnsInQuickFilter
          animateRows={!calm}
          tooltipShowDelay={300}
          suppressRowVirtualisation={!virtualise}
          suppressColumnVirtualisation={!virtualise}
          onGridReady={onReadyCb}
          onModelUpdated={(e) => {
            setShown(e.api.getDisplayedRowCount());
          }}
          onSelectionChanged={(e) => {
            const picked = e.api.getSelectedRows();
            setSelected(picked);
            const last = picked[picked.length - 1];
            if (last !== undefined) onOpenEntry?.(last.seq);
          }}
          onCellKeyDown={(e: CellKeyDownEvent<LedgerRow>) => {
            const ev = e.event;
            if (ev instanceof KeyboardEvent && ev.key === 'Enter' && e.node !== null) {
              e.node.setSelected(true, true);
            }
          }}
          noRowsOverlayComponent={NoRows}
        />
      </div>
      {showDetail && (
        <aside className="gv-griddetail" aria-label={t('ledger.detail.region')} aria-live="polite">
          {detail === null ? (
            <p>{t('ledger.detail.empty')}</p>
          ) : (
            <>
              <header>
                <h3>{t('ledger.detail.title', { seq: detail.seq })}</h3>
                <Button
                  variant="outline"
                  tone="neutral"
                  onClick={() => {
                    api?.deselectAll();
                  }}
                >
                  {t('ledger.detail.close')}
                </Button>
              </header>
              <dl>
                <dt>{t('ledger.col.at')}</dt>
                <dd className="gv-grid-num">{formatStamp(detail.at)}</dd>
                <dt>{t('ledger.col.type')}</dt>
                <dd>{typeLabel(detail.type)}</dd>
                {detail.actor !== null && (
                  <>
                    <dt>{t('ledger.col.actor')}</dt>
                    <dd>{actorLabel(detail.actor)}</dd>
                  </>
                )}
                {detail.amountCents !== null && (
                  <>
                    <dt>{t('ledger.col.amount')}</dt>
                    <dd className="gv-grid-num">{formatUsd(detail.amountCents)}</dd>
                  </>
                )}
                {detail.note !== null && (
                  <>
                    <dt>{t('ledger.col.note')}</dt>
                    <dd>{detail.note}</dd>
                  </>
                )}
                <dt>{t('ledger.col.status')}</dt>
                <dd>{statusText(detail.status)}</dd>
                {detail.hash !== null && (
                  <>
                    <dt>{t('ledger.detail.hash')}</dt>
                    <dd>
                      <code className="gv-grid-hash">{detail.hash}</code>
                    </dd>
                    <dt>{t('ledger.detail.prev')}</dt>
                    <dd>
                      <code className="gv-grid-hash">{detail.prev ?? ''}</code>
                    </dd>
                  </>
                )}
              </dl>
            </>
          )}
        </aside>
      )}
    </section>
  );
}

function statusText(s: LedgerRow['status']): string {
  switch (s) {
    case 'verified':
      return t('ledger.status.verified');
    case 'tampered':
      return t('ledger.status.tampered');
    case 'broken':
      return t('ledger.status.broken');
    case 'unsealed':
      return t('ledger.status.unsealed');
    case 'checking':
      return t('ledger.status.checking');
  }
}

function NoRows() {
  return <p role="status">{t('grid.noRows')}</p>;
}
