import { useState, type ReactNode } from 'react';
import { t } from '../../copy/t';
import type { CopyKey } from '../../copy/en';
import { Icon, type IconName } from '../../design/icons';
import type { AuditPayload, BidSource } from '../../wire';
import { formatUsdCompact } from '../../util/money';

/** Actions that can appear as a control row. Stop is only listed: its route is the owner's. */
export const STREAM_CONTROLS = ['open', 'pause', 'resume', 'extend', 'hammer', 'stop'] as const;
export type StreamControl = (typeof STREAM_CONTROLS)[number];

export type BidStreamStatus = 'accepted' | 'rejected' | 'pending';

export interface BidStreamRow {
  id: string;
  /** Server time, epoch ms. */
  serverTs: number;
  seq: number;
  paddle: number | null;
  /** Integer cents, or null when the bid had no readable amount. */
  amountCents: number | null;
  source: BidSource;
  /** 0..1, voice bids only. */
  confidence: number | null;
  status: BidStreamStatus;
  /** Wire error code or reason text for a rejected row. */
  reason: string | null;
  /** Set on a row that echoes a control command instead of a bid. */
  control?: StreamControl;
}

/** Row height in px. Fixed, so the window of visible rows is plain arithmetic. */
export const ROW_HEIGHT = 36;
/** Rows drawn above and below the visible window. */
export const OVERSCAN = 4;
/** At or below this many rows the whole list is drawn (R-WEB-065 asks for a window above 200). */
export const VIRTUALIZE_ABOVE = 200;
const DEFAULT_VIEWPORT = 320;

const SOURCE_ICON: Readonly<Record<BidSource, IconName>> = {
  voice: 'mic',
  qr: 'qr',
  manual: 'keyboard',
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

const STATUS_KEY = {
  accepted: 'console.status.accepted',
  rejected: 'console.status.rejected',
  pending: 'console.status.pending',
} as const satisfies Record<BidStreamStatus, CopyKey>;

/** Reason copy for a rejected row or an inline rejection. Codes whose catalog text needs a value get a plain variant. */
export function rejectionText(reason: string | null | undefined): string {
  switch (reason) {
    case null:
    case undefined:
    case '':
      return t('console.rej.none');
    case 'over_ceiling':
      return t('console.rej.over_ceiling');
    case 'below_increment':
      return t('console.rej.below_increment');
    case 'closed':
    case 'lot_not_open':
      return t('bid.rej.closed');
    case 'already_leading':
      return t('bid.rej.already_leading');
    case 'below_reserve':
      return t('bid.rej.below_reserve');
    case 'unregistered':
    case 'ceiling_revoked':
      return t('bid.rej.unregistered');
    case 'auction_paused':
      return t('bid.paused');
    default:
      return t('bid.rej.generic');
  }
}

/** The control action an audit record echoes, or null for a bid record. */
function controlOf(a: AuditPayload): StreamControl | null {
  if (a.reason === undefined || !a.reason.startsWith('control:')) return null;
  const action = a.reason.slice('control:'.length);
  return STREAM_CONTROLS.find((c) => c === action) ?? null;
}

/**
 * Builds stream rows from audit records, newest first. A voice record that was superseded
 * before the auctioneer answered shows as pending.
 */
export function rowsFromAudit(
  audit: readonly AuditPayload[],
  paddleOf: (bidderId: string) => number | null,
): BidStreamRow[] {
  return audit
    .map((a): BidStreamRow => {
      const control = controlOf(a);
      if (control !== null) {
        return {
          id: a.bidId,
          serverTs: Number(a.serverTs),
          seq: a.seq,
          paddle: null,
          amountCents: null,
          source: a.source,
          confidence: null,
          status: a.outcome === 'accepted' ? 'accepted' : 'rejected',
          reason: a.outcome === 'accepted' ? null : (a.reason ?? null),
          control,
        };
      }
      const status: BidStreamStatus =
        a.outcome === 'accepted'
          ? 'accepted'
          : a.source === 'voice' && a.confirmed === false && a.outcome === 'superseded'
            ? 'pending'
            : 'rejected';
      return {
        id: a.bidId,
        serverTs: Number(a.serverTs),
        seq: a.seq,
        paddle: paddleOf(a.bidderId),
        amountCents: a.parsedAmount === undefined ? null : Number(a.parsedAmount),
        source: a.source,
        confidence: a.confidence ?? null,
        status,
        reason: a.reason ?? null,
      };
    })
    .sort((x, y) => y.seq - x.seq);
}

/** The slice of rows to draw for a scroll offset. */
export function visibleWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
): { start: number; end: number } {
  if (total <= VIRTUALIZE_ABOVE) return { start: 0, end: total };
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT);
  const count = Math.ceil(viewportHeight / ROW_HEIGHT);
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(total, first + count + OVERSCAN),
  };
}

/** HH:MM:SS in UTC, from server time. */
export function formatServerTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

function Row({ row, top }: { row: BidStreamRow; top: number | null }): ReactNode {
  const style =
    top === null ? undefined : { position: 'absolute' as const, top, height: ROW_HEIGHT };
  if (row.control !== undefined) {
    return (
      <li
        className="gv-stream__row"
        data-kind="control"
        data-control={row.control}
        data-status={row.status}
        style={style}
      >
        <time className="tabular" dateTime={new Date(row.serverTs).toISOString()}>
          {formatServerTime(row.serverTs)}
        </time>
        <span>{t(CONTROL_KEY[row.control])}</span>
        <span>{t(STATUS_KEY[row.status])}</span>
      </li>
    );
  }
  return (
    <li className="gv-stream__row" data-status={row.status} data-source={row.source} style={style}>
      <time className="tabular" dateTime={new Date(row.serverTs).toISOString()}>
        {formatServerTime(row.serverTs)}
      </time>
      <span>
        {row.paddle === null ? t('console.paddleNone') : t('console.paddle', { n: row.paddle })}
      </span>
      <span className="tabular">
        {row.amountCents === null ? '' : formatUsdCompact(row.amountCents)}
      </span>
      <span>
        <Icon name={SOURCE_ICON[row.source]} size={16} title={t(SOURCE_KEY[row.source])} />
      </span>
      <span className="tabular">
        {row.source === 'voice' && row.confidence !== null
          ? t('console.confidence', { pct: Math.round(row.confidence * 100) })
          : ''}
      </span>
      <span>
        {t(STATUS_KEY[row.status])}
        {row.status === 'rejected' && (
          <span className="gv-stream__reason"> {rejectionText(row.reason)}</span>
        )}
      </span>
    </li>
  );
}

export interface BidStreamProps {
  rows: readonly BidStreamRow[];
  /** Height of the scrolling area in px. */
  viewportHeight?: number;
}

/** Newest-first bid events. Draws a window of rows once there are more than 200 (R-WEB-065). */
export function BidStream({ rows, viewportHeight = DEFAULT_VIEWPORT }: BidStreamProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const sorted = [...rows].sort((a, b) => b.seq - a.seq);

  if (sorted.length === 0) {
    return (
      <section className="gv-stream" aria-label={t('console.stream')}>
        <p>{t('console.noBids')}</p>
      </section>
    );
  }

  const virtual = sorted.length > VIRTUALIZE_ABOVE;
  const { start, end } = visibleWindow(sorted.length, scrollTop, viewportHeight);
  return (
    <section className="gv-stream" aria-label={t('console.stream')}>
      <div
        className="gv-stream__scroll"
        style={{ height: viewportHeight, overflowY: 'auto' }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <ul
          className="gv-stream__list"
          style={
            virtual
              ? { position: 'relative', height: sorted.length * ROW_HEIGHT, margin: 0, padding: 0 }
              : undefined
          }
        >
          {sorted.slice(start, end).map((row, i) => (
            <Row
              key={`${row.id}-${row.seq}`}
              row={row}
              top={virtual ? (start + i) * ROW_HEIGHT : null}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
