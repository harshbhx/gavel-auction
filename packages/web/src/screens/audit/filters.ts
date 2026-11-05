import type { AuditPayload, BidSource } from '../../wire';

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
}

export const EMPTY_FILTERS: AuditFilters = {
  paddle: null,
  outcome: null,
  source: null,
  confidenceBelow: null,
  text: '',
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
  return rows.filter((row) => {
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
