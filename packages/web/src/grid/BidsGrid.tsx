import type { ColDef, GridApi, GridReadyEvent, ICellRendererParams } from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CopyKey } from '../copy/en';
import { t } from '../copy/t';
import { Icon } from '../design/icons';
import { Chip, type ChipTone } from '../design/primitives/Chip';
import type { BidSource } from '../wire';
import { formatUsd, formatUsdCompact } from '../util/money';
import {
  formatServerTime,
  rejectionText,
  type BidStreamRow,
  type BidStreamStatus,
  type StreamControl,
} from '../screens/console/BidStream';
import { AgGridReact } from './agRuntime';
import { gridStateFor, useColumnMemory } from './columnMemory';
import { exportBaseName } from './exportName';
import { GridToolbar } from './GridToolbar';
import { bidRowId, diffBids, isEmptyDiff } from './bidsModel';
import { gavelTheme } from './theme';
import { useNarrow, useReducedMotion } from './useGridEnv';
import './grid.css';

export interface BidsGridProps {
  /** The bid history, in any order. Each change is applied to the grid as a transaction. */
  rows: readonly BidStreamRow[];
  /** Height in px. Default: set by CSS. */
  height?: number;
  narrow?: boolean;
  virtualise?: boolean;
  onReady?: (api: GridApi<BidStreamRow>) => void;
  label?: string;
  /** Room id, for the CSV file name (`gavel-bids-<room>-<time>.csv`). */
  roomId?: string;
  /** Remember sort, column order and widths in sessionStorage. Default true. */
  remember?: boolean;
}

const STATUS_KEY = {
  accepted: 'console.status.accepted',
  rejected: 'console.status.rejected',
  pending: 'console.status.pending',
} as const satisfies Record<BidStreamStatus, CopyKey>;
const STATUS_TONE: Readonly<Record<BidStreamStatus, ChipTone>> = {
  accepted: 'success',
  rejected: 'danger',
  pending: 'warning',
};
const SOURCE_KEY = {
  voice: 'console.src.voice',
  qr: 'console.src.qr',
  manual: 'console.src.manual',
} as const satisfies Record<BidSource, CopyKey>;
const CONTROL_KEY = {
  open: 'console.echo.open',
  pause: 'console.echo.pause',
  resume: 'console.echo.resume',
  extend: 'console.echo.extend',
  hammer: 'console.echo.hammer',
  stop: 'console.echo.stop',
} as const satisfies Record<StreamControl, CopyKey>;

function statusCell(p: ICellRendererParams<BidStreamRow>) {
  const row = p.data;
  if (row === undefined) return null;
  return (
    <Chip
      state={row.status}
      label={t(STATUS_KEY[row.status])}
      icon={
        <Icon
          name={row.status === 'accepted' ? 'check' : row.status === 'pending' ? 'clock' : 'stop'}
          size={14}
        />
      }
      tone={STATUS_TONE[row.status]}
    />
  );
}

function reasonText(row: BidStreamRow): string {
  if (row.control !== undefined) return t(CONTROL_KEY[row.control]);
  return row.status === 'rejected' ? rejectionText(row.reason) : '';
}

/**
 * The console's live bid history as an AG Grid table. New and changed bids go in with
 * applyTransaction (add and update, keyed by getRowId), so the rows that did not change are never
 * rebuilt; changed cells flash unless the visitor asked for less motion. Newest first.
 */
export default function BidsGrid({
  rows,
  height,
  narrow: narrowProp,
  virtualise = true,
  onReady,
  label,
  roomId = 'room',
  remember = true,
}: BidsGridProps) {
  const narrow = useNarrow(narrowProp);
  const calm = useReducedMotion();
  const [api, setApi] = useState<GridApi<BidStreamRow> | null>(null);
  const [shown, setShown] = useState(rows.length);
  const memoryKey = remember ? `bids.${narrow ? 'cards' : 'table'}` : null;
  useColumnMemory(api as GridApi | null, memoryKey);
  const initialState = useMemo(() => gridStateFor(memoryKey), [memoryKey]);
  // The grid is given its first rows once; every later change is a transaction.
  const [initial] = useState<readonly BidStreamRow[]>(rows);
  const applied = useRef<readonly BidStreamRow[]>(initial);

  useEffect(() => {
    if (api === null) return;
    const diff = diffBids(applied.current, rows);
    applied.current = rows;
    if (isEmptyDiff(diff)) return;
    setShown(api.getDisplayedRowCount());
    const res = api.applyTransaction(diff);
    if (!calm && res !== null && res !== undefined && res.add.length > 0) {
      api.flashCells({ rowNodes: res.add, columns: ['amount', 'status'] });
    }
  }, [rows, api, calm]);

  const columns = useMemo<ColDef<BidStreamRow>[]>(
    () => [
      {
        colId: 'seq',
        headerName: t('ledger.col.seq'),
        field: 'seq',
        width: 80,
        initialSort: 'desc',
        cellClass: 'gv-grid-num',
        hide: narrow,
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'time',
        headerName: t('bids.col.time'),
        field: 'serverTs',
        width: narrow ? 84 : 110,
        valueFormatter: (p) => (typeof p.value === 'number' ? formatServerTime(p.value) : ''),
        cellClass: 'gv-grid-num',
      },
      {
        colId: 'paddle',
        headerName: t('bids.col.paddle'),
        field: 'paddle',
        width: narrow ? 76 : 100,
        valueFormatter: (p) => (typeof p.value === 'number' ? String(p.value) : ''),
        cellClass: 'gv-grid-num',
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'amount',
        headerName: t('bids.col.amount'),
        field: 'amountCents',
        type: 'rightAligned',
        width: narrow ? 88 : 130,
        valueFormatter: (p) => (typeof p.value === 'number' ? formatUsdCompact(p.value) : ''),
        cellClass: 'gv-grid-num',
        enableCellChangeFlash: !calm,
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'source',
        headerName: t('bids.col.source'),
        valueGetter: (p) => (p.data === undefined ? '' : t(SOURCE_KEY[p.data.source])),
        width: 120,
        hide: narrow,
        filter: 'agTextColumnFilter',
      },
      {
        colId: 'confidence',
        headerName: t('bids.col.confidence'),
        field: 'confidence',
        type: 'rightAligned',
        width: 130,
        valueFormatter: (p) =>
          typeof p.value === 'number'
            ? t('console.confidence', { pct: Math.round(p.value * 100) })
            : '',
        hide: narrow,
        filter: 'agNumberColumnFilter',
      },
      {
        colId: 'status',
        headerName: t('bids.col.status'),
        valueGetter: (p) => (p.data === undefined ? '' : t(STATUS_KEY[p.data.status])),
        cellRenderer: statusCell,
        enableCellChangeFlash: !calm,
        ...(narrow ? { flex: 1 } : {}),
        minWidth: 110,
        width: 150,
        filter: 'agTextColumnFilter',
      },
      {
        colId: 'reason',
        headerName: t('bids.col.reason'),
        valueGetter: (p) => (p.data === undefined ? '' : reasonText(p.data)),
        flex: 1,
        minWidth: 160,
        hide: narrow,
        filter: 'agTextColumnFilter',
      },
    ],
    [narrow, calm],
  );

  const onGridReady = useCallback(
    (e: GridReadyEvent<BidStreamRow>) => {
      setApi(e.api);
      onReady?.(e.api);
    },
    [onReady],
  );

  return (
    <section className="gv-gridwrap" aria-label={label ?? t('bids.region')}>
      <GridToolbar
        api={api as GridApi | null}
        quickLabel={t('bids.quick')}
        quickHint={t('bids.quickHint')}
        shown={shown}
        total={rows.length}
        count={t('bids.shown', { shown, total: rows.length })}
        fileName={exportBaseName('bids', roomId)}
        memoryKey={memoryKey}
        exportKeys={['seq', 'time', 'paddle', 'amount', 'source', 'confidence', 'status', 'reason']}
        processCell={(colId, data) => {
          const row = data as BidStreamRow | undefined;
          if (row === undefined) return undefined;
          if (colId === 'time') return new Date(row.serverTs).toISOString();
          if (colId === 'amount') return row.amountCents === null ? '' : formatUsd(row.amountCents);
          if (colId === 'confidence') return row.confidence === null ? '' : String(row.confidence);
          if (colId === 'reason') return reasonText(row);
          return undefined;
        }}
      />
      <p className="gv-grid-sr">{t('grid.kbd.help')}</p>
      <div
        className="gv-gridbox gv-gridbox--bids"
        data-testid="bids-grid"
        style={height === undefined ? undefined : { height }}
      >
        <AgGridReact<BidStreamRow>
          {...(initialState === undefined ? {} : { initialState })}
          theme={gavelTheme}
          rowData={initial as BidStreamRow[]}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true }}
          getRowId={(p) => bidRowId(p.data)}
          getRowClass={(p) => (p.data === undefined ? undefined : `gv-bid--${p.data.status}`)}
          includeHiddenColumnsInQuickFilter
          animateRows={!calm}
          cellFlashDuration={calm ? 0 : 900}
          cellFadeDuration={calm ? 0 : 600}
          suppressRowVirtualisation={!virtualise}
          suppressColumnVirtualisation={!virtualise}
          onGridReady={onGridReady}
          tabToNextCell={() => false}
          tabToNextHeader={() => false}
          onModelUpdated={(e) => {
            setShown(e.api.getDisplayedRowCount());
          }}
        />
      </div>
    </section>
  );
}
