/**
 * The ledger's filters in the page URL, so a link opens the same filtered ledger.
 * `gq` is the search text, `gf` the AG Grid filter model as JSON. Other query keys are left alone.
 */
export const QUICK_PARAM = 'gq';
export const MODEL_PARAM = 'gf';

/** Columns whose filter may come from a link. Anything else in the URL is dropped. */
const FILTER_COLUMNS = ['seq', 'at', 'type', 'actor', 'amount', 'hash', 'note', 'status'] as const;
const MAX_QUICK = 120;
const MAX_MODEL = 2000;

export type FilterModel = Record<string, unknown>;

export interface LedgerUrlState {
  quick: string;
  model: FilterModel;
}

function plainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keeps only known columns whose value is a filter object; a bad link yields no filter, not an error. */
export function cleanModel(raw: unknown): FilterModel {
  if (!plainObject(raw)) return {};
  const out: FilterModel = {};
  for (const col of FILTER_COLUMNS) {
    const v = Object.prototype.hasOwnProperty.call(raw, col) ? raw[col] : undefined;
    if (plainObject(v) && typeof v.filterType === 'string') out[col] = v;
  }
  return out;
}

export function readLedgerUrl(search: string): LedgerUrlState {
  const q = new URLSearchParams(search);
  const quick = (q.get(QUICK_PARAM) ?? '').slice(0, MAX_QUICK);
  const rawModel = q.get(MODEL_PARAM);
  let model: FilterModel = {};
  if (rawModel !== null && rawModel.length <= MAX_MODEL) {
    try {
      model = cleanModel(JSON.parse(rawModel));
    } catch {
      model = {};
    }
  }
  return { quick, model };
}

/** The same search string with the ledger's keys set to this state (and removed when empty). */
export function withLedgerState(search: string, state: LedgerUrlState): string {
  const q = new URLSearchParams(search);
  q.delete(QUICK_PARAM);
  q.delete(MODEL_PARAM);
  if (state.quick !== '') q.set(QUICK_PARAM, state.quick.slice(0, MAX_QUICK));
  const model = cleanModel(state.model);
  if (Object.keys(model).length > 0) q.set(MODEL_PARAM, JSON.stringify(model));
  const out = q.toString();
  return out === '' ? '' : `?${out}`;
}

export function writeLedgerUrl(state: LedgerUrlState): void {
  const { pathname, search, hash } = window.location;
  const next = `${pathname}${withLedgerState(search, state)}${hash}`;
  if (next !== `${pathname}${search}${hash}`)
    window.history.replaceState(window.history.state, '', next);
}
