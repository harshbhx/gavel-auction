import type {
  CellKeyDownEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
  RowClassParams,
} from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '../copy/t';
import { Button } from '../design/primitives/Button';
import { sha256Hex } from '../util/hash';
import { formatUsd } from '../util/money';
import { AgGridReact } from './agRuntime';
import { cardCell, statusCell, typeCell, type LedgerRow } from './cells';
import { useColumnMemory } from './columnMemory';
import { exportBaseName } from './exportName';
import { GridToolbar, type SortOption } from './GridToolbar';
import { actorLabel, typeLabel } from './labels';
import { LedgerFilterBar, type TypeOption } from './LedgerFilterBar';
import {
  GENESIS_PREV,
  chainCounts,
  firstBad,
  revealStep,
  formatStamp,
  shortHash,
  verifyEntries,
  type ChainStatus,
  type HashFn,
  type LedgerEntry,
} from './ledgerModel';
import { gavelTheme } from './theme';
import { useNarrow, useReducedMotion } from './useGridEnv';
import { cleanModel, readLedgerUrl, writeLedgerUrl, type FilterModel } from './urlState';
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
  /** Room id, for the CSV file name (`gavel-ledger-<room>-<time>.csv`). */
  roomId?: string;
  /** Keep the search and filters in the page URL (`gq`, `gf`), so a link opens this filtered view. */
  urlState?: boolean;
  /** Remember sort, column order and widths in sessionStorage. Default true. */
  remember?: boolean;
  /** Called with the seq of the entry a visitor selects (a click or Enter on a row). */
  onOpenEntry?: (seq: number) => void;
  /** Show the built-in detail panel under the grid. Default true; a page with its own sheet turns it off. */
  detail?: boolean;
  /** Accessible name of the table region. */
  label?: string;
}

/** One run of the "Verify chain" action: hashes recomputed, then results shown row by row. */
interface VerifyRun {
  phase: 'hashing' | 'revealing' | 'done';
  /** Rows revealed so far, counted from the first entry. */
  done: number;
  result: ReadonlyMap<number, ChainStatus>;
}

const REVEAL_MS = 45;

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
  roomId = 'room',
  urlState = false,
  remember = true,
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

  const [run, setRun] = useState<VerifyRun | null>(null);
  const runId = useRef(0);
  const timer = useRef<number | null>(null);
  const stopRun = useCallback((): void => {
    runId.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  // New entries (or leaving the page) end a run: its marks belong to the entries it checked.
  useEffect(() => {
    setRun(null);
    return stopRun;
  }, [entries, stopRun]);

  const startVerify = useCallback(async (): Promise<void> => {
    stopRun();
    const id = runId.current;
    setRun({ phase: 'hashing', done: 0, result: new Map() });
    let result: Map<number, ChainStatus>;
    try {
      result = await verifyEntries(entries, hash);
    } catch {
      if (id === runId.current) setRun(null);
      return;
    }
    if (id !== runId.current) return;
    const total = entries.length;
    // Reduced motion: show the whole result at once, no row-by-row reveal.
    const step = calm ? total : revealStep(total);
    let done = 0;
    const tick = (): void => {
      if (id !== runId.current) return;
      done = Math.min(total, done + step);
      const finished = done >= total;
      setRun({ phase: finished ? 'done' : 'revealing', done, result });
      if (finished) {
        onChecked?.(result);
        return;
      }
      timer.current = window.setTimeout(tick, REVEAL_MS);
    };
    tick();
    // onChecked is a callback for the parent; a new function must not rebuild this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, hash, calm, stopRun]);

  const rows = useMemo<LedgerRow[]>(
    () =>
      entries.map((e, i): LedgerRow => {
        if (e.hash === null) return { ...e, status: 'unsealed' };
        // While a run reveals its result, rows it has not reached yet read "Checking".
        if (run !== null && run.phase !== 'done') {
          return i < run.done
            ? { ...e, status: run.result.get(e.seq) ?? 'checking', checked: true }
            : { ...e, status: 'checking' };
        }
        return {
          ...e,
          status: statuses?.get(e.seq) ?? 'checking',
          ...(run !== null ? { checked: true } : {}),
        };
      }),
    [entries, statuses, run],
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
        filter: 'agTextColumnFilter',
        filterValueGetter: (p) => p.data?.hash ?? '',
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
    if (s === 'tampered' || s === 'broken') return 'gv-grid-row--bad';
    return p.data?.checked === true && s === 'verified' ? 'gv-grid-row--ok' : undefined;
  }, []);

  // Filters and search: held in the URL when asked, so a shared link opens the same view.
  const start = useMemo(
    () => (urlState ? readLedgerUrl(window.location.search) : { quick: '', model: {} }),
    [urlState],
  );
  const live = useRef<{ quick: string; model: FilterModel }>(start);
  const [model, setModel] = useState<FilterModel>(start.model);
  const memoryKey = remember
    ? `ledger.${hasHash ? 'sealed' : 'plain'}.${narrow ? 'cards' : 'table'}`
    : null;
  useColumnMemory(api as GridApi | null, memoryKey);

  const pushUrl = useCallback(
    (patch: Partial<{ quick: string; model: FilterModel }>): void => {
      live.current = { ...live.current, ...patch };
      if (urlState) writeLedgerUrl(live.current);
    },
    [urlState],
  );
  const onQuickChange = useCallback(
    (text: string): void => {
      pushUrl({ quick: text });
    },
    [pushUrl],
  );

  const types = useMemo<TypeOption[]>(() => {
    const seen = new Map<string, TypeOption>();
    for (const e of entries) {
      const label = typeLabel(e.type);
      if (!seen.has(label)) seen.set(label, { value: label, label });
    }
    return [...seen.values()];
  }, [entries]);

  const onReadyCb = useCallback(
    (e: GridReadyEvent<LedgerRow>) => {
      // A link's filters (or the ones held before the grid was rebuilt) go in once the grid exists.
      const { quick, model: held } = live.current;
      try {
        if (Object.keys(held).length > 0) e.api.setFilterModel(cleanModel(held));
      } catch {
        // A filter the grid does not accept is dropped; the unfiltered ledger shows.
      }
      if (quick !== '') e.api.setGridOption('quickFilterText', quick);
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
        fileName={exportBaseName('ledger', roomId)}
        memoryKey={memoryKey}
        onQuickChange={onQuickChange}
        initialQuick={start.quick}
        exportKeys={EXPORT_KEYS.filter((k) => (k !== 'hash' && k !== 'prev') || hasHash)}
        processCell={exportCell}
        selectedCount={selected.length}
        {...(narrow ? { sortOptions } : {})}
      >
        {hasHash && (
          <Button
            variant="outline"
            tone="neutral"
            disabled={run !== null && run.phase !== 'done'}
            onClick={() => {
              void startVerify();
            }}
          >
            {run === null ? t('grid.verify.button') : t('grid.verify.again')}
          </Button>
        )}
      </GridToolbar>
      <LedgerFilterBar
        api={api as GridApi | null}
        model={model}
        types={types}
        showHash={hasHash}
        showPaddle={hasActor}
        linkable={urlState}
      />
      {hasHash && <p className="gv-gridscope">{t('grid.verify.scope')}</p>}
      {run !== null && (
        <p
          className="gv-gridchain"
          data-state={run.phase === 'done' ? 'ok' : 'checking'}
          role="status"
        >
          {run.phase === 'hashing'
            ? t('grid.verify.hashing', { n: entries.length })
            : run.phase === 'revealing'
              ? t('grid.verify.progress', { done: run.done, total: entries.length })
              : firstBad(run.result) === null
                ? t('grid.verify.done', { n: entries.length })
                : t('ledger.chain.bad', { n: firstBad(run.result) ?? 0 })}
        </p>
      )}
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
      <p className="gv-grid-sr">{t('grid.kbd.help')}</p>
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
          tabToNextCell={() => false}
          tabToNextHeader={() => false}
          onFilterChanged={(e) => {
            const m = e.api.getFilterModel() as FilterModel;
            setModel(m);
            pushUrl({ model: m });
          }}
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
