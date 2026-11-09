import type {
  ColDef,
  ColSpanParams,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
} from 'ag-grid-community';
import type { SettlementState } from '@gavel/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CopyKey } from '../copy/en';
import { t } from '../copy/t';
import { Icon, type IconName } from '../design/icons';
import { Chip, type ChipTone } from '../design/primitives/Chip';
import { formatUsd } from '../util/money';
import { AgGridReact } from './agRuntime';
import { columnMemoryProps, gridStateFor, restoreSort } from './columnMemory';
import { exportBaseName } from './exportName';
import { GridToolbar } from './GridToolbar';
import { holdTotals, totalsAddUp, type HoldRow } from './holdsModel';
import { gavelTheme } from './theme';
import { useNarrow, useReducedMotion } from './useGridEnv';
import './grid.css';

export interface HoldsGridProps {
  rows: readonly HoldRow[];
  /** Show the simulated day column (the lab page does). */
  showDay?: boolean;
  height?: number;
  narrow?: boolean;
  virtualise?: boolean;
  onReady?: (api: GridApi<HoldRow>) => void;
  label?: string;
  /** Room id, for the CSV file name (`gavel-holds-<room>-<time>.csv`). */
  roomId?: string;
  /** Remember sort, column order and widths in sessionStorage. Default true. */
  remember?: boolean;
}

const STATE_KEY = {
  HELD: 'ladder.state.HELD',
  BIDDING: 'ladder.state.BIDDING',
  WINNER_SELECTED: 'ladder.state.WINNER_SELECTED',
  CAPTURING: 'ladder.state.CAPTURING',
  CAPTURED: 'ladder.state.CAPTURED',
  VOIDING: 'ladder.state.VOIDING',
  SETTLED: 'ladder.state.SETTLED',
  FALLBACK_RUNNER_UP: 'ladder.state.FALLBACK_RUNNER_UP',
  FAILED_NEEDS_REVIEW: 'ladder.state.FAILED_NEEDS_REVIEW',
} as const satisfies Record<SettlementState, CopyKey>;

const STATE_TONE: Readonly<Record<SettlementState, ChipTone>> = {
  HELD: 'warning',
  BIDDING: 'neutral',
  WINNER_SELECTED: 'accent',
  CAPTURING: 'accent',
  CAPTURED: 'accent',
  VOIDING: 'neutral',
  SETTLED: 'neutral',
  FALLBACK_RUNNER_UP: 'warning',
  FAILED_NEEDS_REVIEW: 'danger',
};

const STATE_ICON: Readonly<Record<SettlementState, IconName>> = {
  HELD: 'hollow',
  BIDDING: 'current',
  WINNER_SELECTED: 'check',
  CAPTURING: 'clock',
  CAPTURED: 'lock',
  VOIDING: 'clock',
  SETTLED: 'check',
  FALLBACK_RUNNER_UP: 'hand',
  FAILED_NEEDS_REVIEW: 'warning',
};

export function stateLabel(state: SettlementState): string {
  return t(STATE_KEY[state]);
}

function stateCell(p: ICellRendererParams<HoldRow>) {
  if (p.data === undefined || p.node.rowPinned) return null;
  return (
    <Chip
      state={p.data.state}
      label={stateLabel(p.data.state)}
      icon={<Icon name={STATE_ICON[p.data.state]} size={14} />}
      tone={STATE_TONE[p.data.state]}
    />
  );
}

const TOTALS_ID = 'totals';

function totalsRow(rows: readonly HoldRow[]): HoldRow {
  const sum = holdTotals(rows);
  return {
    id: TOTALS_ID,
    ref: t('holds.totals', { n: sum.count }),
    paddle: 0,
    state: 'HELD',
    heldCents: sum.heldCents,
    capturedCents: sum.capturedCents,
    releasedCents: sum.releasedCents,
  };
}

const money = (v: unknown): string => (typeof v === 'number' ? formatUsd(v) : '');

/**
 * Holds and their settlement state as an AG Grid table, with a pinned totals row at the bottom that
 * follows the filters. Every state shows a word and an icon, never colour alone.
 */
export default function HoldsGrid({
  rows,
  showDay = false,
  height,
  narrow: narrowProp,
  virtualise = true,
  onReady,
  label,
  roomId = 'room',
  remember = true,
}: HoldsGridProps) {
  const narrow = useNarrow(narrowProp);
  const calm = useReducedMotion();
  const [api, setApi] = useState<GridApi<HoldRow> | null>(null);
  const [shown, setShown] = useState(rows.length);
  const memoryKey = remember
    ? `holds.${showDay ? 'days' : 'room'}.${narrow ? 'cards' : 'table'}`
    : null;
  const initialState = useMemo(() => gridStateFor(memoryKey), [memoryKey]);

  const pinTotals = useCallback((a: GridApi<HoldRow>) => {
    const visible: HoldRow[] = [];
    a.forEachNodeAfterFilter((n) => {
      if (n.data !== undefined) visible.push(n.data);
    });
    a.setGridOption('pinnedBottomRowData', [totalsRow(visible)]);
    setShown(visible.length);
  }, []);

  useEffect(() => {
    if (api !== null) pinTotals(api);
  }, [api, rows, pinTotals]);

  const span = (p: ColSpanParams<HoldRow>): number => {
    if (!p.node?.rowPinned) return 1;
    return narrow ? 2 : showDay ? 3 : 2;
  };

  const columns = useMemo<ColDef<HoldRow>[]>(
    () => [
      {
        colId: 'ref',
        headerName: t('holds.col.ref'),
        field: 'ref',
        width: 160,
        hide: narrow,
        colSpan: span,
        filter: 'agTextColumnFilter',
      },
      {
        colId: 'paddle',
        headerName: t('holds.col.paddle'),
        field: 'paddle',
        width: narrow ? 120 : 110,
        valueGetter: (p) =>
          p.node?.rowPinned && narrow ? (p.data?.ref ?? '') : (p.data?.paddle ?? ''),
        valueFormatter: (p) => (p.node?.rowPinned && !narrow ? '' : String(p.value ?? '')),
        cellClass: 'gv-grid-num',
        filter: 'agNumberColumnFilter',
        ...(narrow ? { colSpan: span } : {}),
      },
      {
        colId: 'day',
        headerName: t('holds.col.day'),
        field: 'day',
        width: 90,
        hide: !showDay || narrow,
        cellClass: 'gv-grid-num',
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'state',
        headerName: t('holds.col.state'),
        valueGetter: (p) => (p.data === undefined ? '' : stateLabel(p.data.state)),
        cellRenderer: stateCell,
        ...(narrow ? { flex: 1 } : {}),
        minWidth: 150,
        width: 230,
        filter: 'agTextColumnFilter',
      },
      {
        colId: 'held',
        headerName: t('holds.col.held'),
        field: 'heldCents',
        type: 'rightAligned',
        width: 130,
        valueFormatter: (p) => money(p.value),
        cellClass: 'gv-grid-num',
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'final',
        headerName: t('holds.col.final'),
        field: 'capturedCents',
        type: 'rightAligned',
        width: 150,
        valueFormatter: (p) => money(p.value),
        cellClass: 'gv-grid-num',
        hide: narrow,
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'released',
        headerName: t('holds.col.released'),
        field: 'releasedCents',
        type: 'rightAligned',
        width: 140,
        valueFormatter: (p) => money(p.value),
        cellClass: 'gv-grid-num',
        hide: narrow,
        filter: 'agNumberColumnFilter',
      },
    ],
    // span reads narrow and showDay, both listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [narrow, showDay],
  );

  const onGridReady = useCallback(
    (e: GridReadyEvent<HoldRow>) => {
      restoreSort(e.api, memoryKey);
      setApi(e.api);
      onReady?.(e.api);
    },
    [onReady, memoryKey],
  );

  const ok = totalsAddUp(rows);

  return (
    <section className="gv-gridwrap" aria-label={label ?? t('holds.region')}>
      <GridToolbar
        api={api as GridApi | null}
        quickLabel={t('holds.quick')}
        quickHint={t('ledger.quickHint')}
        shown={shown}
        total={rows.length}
        fileName={exportBaseName('holds', roomId)}
        memoryKey={memoryKey}
        exportKeys={[
          'ref',
          'paddle',
          ...(showDay ? ['day'] : []),
          'state',
          'held',
          'final',
          'released',
        ]}
        processCell={(colId, data) => {
          const row = data as HoldRow | undefined;
          if (row === undefined) return undefined;
          if (colId === 'paddle') return row.paddle === 0 ? '' : String(row.paddle);
          if (colId === 'state') return row.id === TOTALS_ID ? '' : stateLabel(row.state);
          return undefined;
        }}
      />
      <p className="gv-gridchain" data-state={ok ? 'ok' : 'bad'} role="status">
        {ok ? t('holds.check.ok') : t('holds.check.bad')}
      </p>
      <p className="gv-grid-sr">{t('grid.kbd.help')}</p>
      <div
        className="gv-gridbox"
        data-testid="holds-grid"
        style={height === undefined ? undefined : { height }}
      >
        <AgGridReact<HoldRow>
          {...(initialState === undefined ? {} : { initialState })}
          {...columnMemoryProps(memoryKey)}
          theme={gavelTheme}
          rowData={rows as HoldRow[]}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true }}
          getRowId={(p) => p.data.id}
          onFilterChanged={(e) => {
            pinTotals(e.api);
          }}
          animateRows={!calm}
          suppressRowVirtualisation={!virtualise}
          suppressColumnVirtualisation={!virtualise}
          onGridReady={onGridReady}
          tabToNextCell={() => false}
          tabToNextHeader={() => false}
        />
      </div>
    </section>
  );
}
