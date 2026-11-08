import type { AuditPayload, BidSource } from '../../wire';
import { TRAIL_KINDS, kindOfRow, type TrailEntry, type TrailKind } from './trail';

export const OUTCOMES = [
  'accepted',
  'rejected',
  'expired',
  'superseded',
] as const satisfies readonly AuditPayload['outcome'][];

export const SOURCES = ['voice', 'qr', 'manual'] as const satisfies readonly BidSource[];

export interface AuditFilters {
  paddle: number | null;
  outcome: AuditPayload['outcome'] | null;
  source: BidSource | null;
  /** Percent 0 to 100: keep rows whose confidence is below this. */
  confidenceBelow: number | null;
  text: string;
  /** Keep one kind of timeline line or ledger row. */
  type: TrailKind | null;
  /** Keep only the last N minutes before the latest recorded event. */
  sinceMin: number | null;
}

export const SINCE_OPTIONS = [1, 5, 15] as const;

export const EMPTY_FILTERS: AuditFilters = {
  paddle: null,
  outcome: null,
  source: null,
  confidenceBelow: null,
  text: '',
  type: null,
  sinceMin: null,
};

function intParam(value: string | null, max: number): number | null {
  if (value === null || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n <= max ? n : null;
}

/** Reads filters from a query string. Unknown or malformed values are ignored. */
export function parseFilters(search: string): AuditFilters {
  const q = new URLSearchParams(search);
  const outcome = q.get('result');
  const source = q.get('source');
  return {
    paddle: intParam(q.get('paddle'), 999_999),
    outcome: OUTCOMES.find((o) => o === outcome) ?? null,
    source: SOURCES.find((s) => s === source) ?? null,
    confidenceBelow: intParam(q.get('conf'), 100),
    text: q.get('q') ?? '',
    type: TRAIL_KINDS.find((k) => k === q.get('type')) ?? null,
    sinceMin: SINCE_OPTIONS.find((m) => String(m) === q.get('since')) ?? null,
  };
}

/** Query string for the filters, without a leading "?". Empty filters are left out. */
export function filtersToSearch(f: AuditFilters): string {
  const q = new URLSearchParams();
  if (f.paddle !== null) q.set('paddle', String(f.paddle));
  if (f.outcome !== null) q.set('result', f.outcome);
  if (f.source !== null) q.set('source', f.source);
  if (f.confidenceBelow !== null) q.set('conf', String(f.confidenceBelow));
  if (f.text !== '') q.set('q', f.text);
  if (f.type !== null) q.set('type', f.type);
  if (f.sinceMin !== null) q.set('since', String(f.sinceMin));
  return q.toString();
}

export function hasActiveFilters(f: AuditFilters): boolean {
  return filtersToSearch(f) !== '';
}

/** Every active filter must match (AND). */
export function applyFilters(
  rows: readonly AuditPayload[],
  f: AuditFilters,
  paddleOf: (bidderId: string) => number | null,
): AuditPayload[] {
  const needle = f.text.trim().toLowerCase();
  const latest = rows.reduce((m, r) => Math.max(m, Number(r.serverTs)), 0);
  return rows.filter((row) => {
    if (f.type !== null && kindOfRow(row) !== f.type) return false;
    if (f.sinceMin !== null && Number(row.serverTs) < latest - f.sinceMin * 60_000) return false;
    if (f.paddle !== null && paddleOf(row.bidderId) !== f.paddle) return false;
    if (f.outcome !== null && row.outcome !== f.outcome) return false;
    if (f.source !== null && row.source !== f.source) return false;
    if (f.confidenceBelow !== null) {
      if (row.confidence === undefined || row.confidence * 100 >= f.confidenceBelow) return false;
    }
    if (needle !== '' && !(row.transcript ?? '').toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * The timeline under the same filters. Lines without a time (holds, settlement) drop out when a
 * time window is set. Outcome, source, confidence and text only describe bid rows, so a line with
 * no row drops out when one of them is set.
 */
export function applyTrailFilters(
  entries: readonly TrailEntry[],
  f: AuditFilters,
  latestAt: number,
): TrailEntry[] {
  const needle = f.text.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.type !== null && e.kind !== f.type) return false;
    if (f.paddle !== null && e.paddle !== f.paddle && e.otherPaddle !== f.paddle) return false;
    if (f.sinceMin !== null && (e.at === null || e.at < latestAt - f.sinceMin * 60_000))
      return false;
    const rowOnly =
      f.outcome !== null || f.source !== null || f.confidenceBelow !== null || needle !== '';
    if (!rowOnly) return true;
    const row = e.row;
    if (row === undefined) return false;
    if (f.outcome !== null && row.outcome !== f.outcome) return false;
    if (f.source !== null && row.source !== f.source) return false;
    if (f.confidenceBelow !== null) {
      if (row.confidence === undefined || row.confidence * 100 >= f.confidenceBelow) return false;
    }
    return needle === '' || (row.transcript ?? '').toLowerCase().includes(needle);
  });
}
