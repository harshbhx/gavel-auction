import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { formatUsd } from '../../util/money';
import type { AuditPayload } from '../../wire';
import { AuditDrawer } from './AuditDrawer';
import type { Names } from './trailText';
import './audit.css';

export type AuditColumn =
  | 'seq'
  | 'serverTs'
  | 'audioTsMs'
  | 'transcript'
  | 'paddle'
  | 'parsedAmount'
  | 'confidence'
  | 'confirmed'
  | 'outcome'
  | 'reason';

/** Column order from R-WEB-080. */
export const AUDIT_COLUMNS: readonly AuditColumn[] = [
  'seq',
  'serverTs',
  'audioTsMs',
  'transcript',
  'paddle',
  'parsedAmount',
  'confidence',
  'confirmed',
  'outcome',
  'reason',
];

export type SortDir = 'ascending' | 'descending';

const AT_BOTTOM_SLACK_PX = 8;

export interface AuditTableProps {
  rows: readonly AuditPayload[];
  /** Paddle for a bidder id, or null when unknown. */
  paddleOf: (bidderId: string) => number | null;
  /** A running room appends rows and follows the bottom; a settled room is read-only. */
  live?: boolean;
  /** Height of the scrolling area in CSS pixels. Absent: the panel sizes it with CSS. */
  height?: number;
  /** True when the rows were narrowed by filters, so an empty table says so. */
  filtered?: boolean;
  names?: Names;
  /** Controlled detail row. Absent: the table keeps its own. */
  open?: AuditPayload | null;
  onOpenChange?: (row: AuditPayload | null) => void;
}

/** mm:ss.mmm from lot start. */
export function formatOffset(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function sortValue(
  row: AuditPayload,
  col: AuditColumn,
  paddleOf: (id: string) => number | null,
): number | string {
  switch (col) {
    case 'seq':
      return row.seq;
    case 'serverTs':
      return row.serverTs;
    case 'audioTsMs':
      return row.audioTsMs ?? -1;
    case 'transcript':
      return row.transcript ?? '';
    case 'paddle':
      return paddleOf(row.bidderId) ?? -1;
    case 'parsedAmount':
      return row.parsedAmount ?? -1;
    case 'confidence':
      return row.confidence ?? -1;
    case 'confirmed':
      return row.confirmed === undefined ? 0 : row.confirmed ? 2 : 1;
    case 'outcome':
      return row.outcome;
    case 'reason':
      return row.reason ?? '';
  }
}

/** Stable sort by one column; ties keep seq order. */
export function sortRows(
  rows: readonly AuditPayload[],
  col: AuditColumn,
  dir: SortDir,
  paddleOf: (id: string) => number | null,
): AuditPayload[] {
  const sign = dir === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, col, paddleOf);
    const y = sortValue(b, col, paddleOf);
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.seq - b.seq;
  });
}

function Cell({
  row,
  col,
  paddleOf,
}: {
  row: AuditPayload;
  col: AuditColumn;
  paddleOf: (id: string) => number | null;
}) {
  switch (col) {
    case 'seq':
      return <>{row.seq}</>;
    case 'serverTs':
      return <>{new Date(row.serverTs).toISOString().slice(11, 23)}</>;
    case 'audioTsMs':
      if (row.audioTsMs === undefined) return null;
      // Start of the spoken bid, then its end when the server sent one.
      return (
        <>
          {formatOffset(row.audioTsMs)}
          {row.audioEndMs === undefined ? null : ` \u2013 ${formatOffset(row.audioEndMs)}`}
        </>
      );
    case 'transcript':
      return <>{row.transcript}</>;
    case 'paddle':
      return <>{paddleOf(row.bidderId)}</>;
    case 'parsedAmount':
      return <>{row.parsedAmount === undefined ? null : formatUsd(row.parsedAmount)}</>;
    case 'confidence':
      return <>{row.confidence === undefined ? null : row.confidence.toFixed(2)}</>;
    case 'confirmed':
      if (row.confirmed === undefined) return <>{t('audit.confirmed.auto')}</>;
      return row.confirmed ? <Icon name="check" /> : <Icon name="stop" />;
    case 'outcome':
      return <>{t(`audit.outcome.${row.outcome}`)}</>;
    case 'reason':
      return <>{row.reason}</>;
  }
}

/** A real table: scope headers, sortable columns with aria-sort, row detail drawer. */
export function AuditTable({
  rows,
  paddleOf,
  live = true,
  height,
  filtered = false,
  names,
  open: openProp,
  onOpenChange,
}: AuditTableProps) {
  const [sortCol, setSortCol] = useState<AuditColumn>('seq');
  const [sortDir, setSortDir] = useState<SortDir>('ascending');
  const [ownOpen, setOwnOpen] = useState<AuditPayload | null>(null);
  const open = openProp === undefined ? ownOpen : openProp;
  const setOpen = (row: AuditPayload | null): void => {
    if (openProp === undefined) setOwnOpen(row);
    onOpenChange?.(row);
  };
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const sorted = useMemo(
    () => sortRows(rows, sortCol, sortDir, paddleOf),
    [rows, sortCol, sortDir, paddleOf],
  );

  // Follow new rows only when the reader is already at the bottom; otherwise leave scroll alone.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (live && el !== null && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [sorted.length, live]);

  const toggle = (col: AuditColumn): void => {
    if (col === sortCol) setSortDir(sortDir === 'ascending' ? 'descending' : 'ascending');
    else {
      setSortCol(col);
      setSortDir('ascending');
    }
  };

  if (rows.length === 0) {
    return (
      <p className="gv-state gv-state--empty" role="status">
        {t(filtered ? 'audit.noMatch' : 'audit.empty')}
      </p>
    );
  }

  const at = open === null ? -1 : sorted.findIndex((r) => r.seq === open.seq);
  const step = (delta: number): (() => void) | undefined => {
    const next = sorted[at + delta];
    return at < 0 || next === undefined ? undefined : () => setOpen(next);
  };

  return (
    <div className="gv-audit-ledger">
      <div
        ref={scroller}
        className="gv-audit-ledger__scroll"
        data-testid="audit-scroll"
        role="region"
        aria-label={t('audit.ledger.scroll')}
        tabIndex={0}
        style={height === undefined ? undefined : { maxHeight: height }}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK_PX;
        }}
      >
        <table>
          <caption className="gv-audit__sr">{t('audit.ledger.title')}</caption>
          <thead>
            <tr>
              {AUDIT_COLUMNS.map((col) => (
                <th key={col} scope="col" aria-sort={col === sortCol ? sortDir : 'none'}>
                  <button type="button" onClick={() => toggle(col)}>
                    {t(`audit.col.${col}`)}
                    <span aria-hidden="true" className="gv-audit-sort">
                      {col === sortCol ? (sortDir === 'ascending' ? '\u25B2' : '\u25BC') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.seq} data-outcome={row.outcome} onClick={() => setOpen(row)}>
                {AUDIT_COLUMNS.map((col, i) =>
                  i === 0 ? (
                    <th key={col} scope="row">
                      <button type="button" onClick={() => setOpen(row)}>
                        <Cell row={row} col={col} paddleOf={paddleOf} />
                      </button>
                    </th>
                  ) : (
                    <td key={col}>
                      <Cell row={row} col={col} paddleOf={paddleOf} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AuditDrawer
        row={open}
        onClose={() => setOpen(null)}
        paddleOf={paddleOf}
        {...(names === undefined ? {} : { names })}
        onPrev={step(-1)}
        onNext={step(1)}
      />
    </div>
  );
}
