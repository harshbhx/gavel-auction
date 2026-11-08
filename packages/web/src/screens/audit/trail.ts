import type { CopyKey } from '../../copy/en';
import type { RoomState } from '../../store/roomReducer';
import type { AuditPayload, BidSource } from '../../wire';

/** Every kind of line the plain-language timeline can show. */
export const TRAIL_KINDS = [
  'hold',
  'bid',
  'outbid',
  'rejected',
  'expired',
  'superseded',
  'extend',
  'pause',
  'stopped',
  'hammer',
  'settlement',
  'receipt',
] as const;
export type TrailKind = (typeof TRAIL_KINDS)[number];

export interface TrailEntry {
  /** Stable key, unique in one trail. */
  id: string;
  kind: TrailKind;
  /** Server time in epoch ms, or null when the room does not know when it happened. */
  at: number | null;
  /** The audit row behind the line, when there is one. */
  row?: AuditPayload;
  paddle: number | null;
  /** The other bidder, for an outbid line. */
  otherPaddle?: number | null;
  amountCents?: number;
  source?: BidSource;
  /** Settlement state key and hold count, for a settlement line. */
  state?: string;
  count?: number;
  /** The closing time, for an extend line. */
  endTs?: number;
}

export type Rosterish = readonly { bidderId: string; paddle: number; name: string; hold: string }[];

/** The kind a ledger row belongs to, for the type filter. */
export function kindOfRow(row: AuditPayload): TrailKind {
  return row.outcome === 'accepted' ? 'bid' : row.outcome;
}

const SETTLE_ORDER = [
  'CAPTURED',
  'CAPTURING',
  'WINNER_SELECTED',
  'FALLBACK_RUNNER_UP',
  'VOIDING',
  'SETTLED',
  'FAILED_NEEDS_REVIEW',
] as const;

/** A copy key for a settlement state label (reused from the ladder, so wording stays in one place). */
export function stateLabelKey(state: string): Extract<CopyKey, `ladder.state.${string}`> {
  return `ladder.state.${state}` as Extract<CopyKey, `ladder.state.${string}`>;
}

function roster(state: RoomState): Rosterish {
  return state.snapshot?.roster ?? [];
}

export function paddleLookup(state: RoomState): (bidderId: string) => number | null {
  const list = roster(state);
  return (id) => list.find((r) => r.bidderId === id)?.paddle ?? null;
}

export function hammerOf(
  state: RoomState,
): { winnerId: string | null; price: number; at: number | null; stopped: boolean } | null {
  if (state.hammer !== null) {
    return {
      winnerId: state.hammer.winnerId,
      price: state.hammer.price,
      at: state.hammer.ts,
      stopped: state.hammer.stopped === true,
    };
  }
  const h = state.snapshot?.hammer;
  if (h === undefined) return null;
  return {
    winnerId: h.winnerId,
    price: h.price,
    at: null,
    stopped: state.snapshot?.stopped === true,
  };
}

/** Holds per settlement state: the public ladder counts, or the roster when none came. */
export function holdCounts(state: RoomState): Readonly<Partial<Record<string, number>>> {
  const counts = state.settlementLadderCounts;
  if (counts !== undefined) return counts;
  const held = roster(state).filter((r) => r.hold === 'HELD').length;
  return held === 0 ? {} : { HELD: held };
}

/**
 * The room as a plain-language timeline, oldest first: holds in place, every bid attempt in seq
 * order with the outbids they caused, then pause, hammer, settlement states and the receipt.
 * Only what the room really knows is listed; nothing is invented.
 */
export function buildTrail(state: RoomState): TrailEntry[] {
  const out: TrailEntry[] = [];
  const paddleOf = paddleLookup(state);
  for (const r of roster(state)) {
    if (r.hold === 'HELD')
      out.push({ id: `hold-${r.bidderId}`, kind: 'hold', at: null, paddle: r.paddle });
  }
  const rows = [...state.audit].sort((a, b) => a.seq - b.seq);
  let leader: { paddle: number | null; bidderId: string } | null = null;
  for (const row of rows) {
    const paddle = paddleOf(row.bidderId);
    const base = {
      at: Number(row.serverTs),
      row,
      paddle,
      source: row.source,
      ...(row.parsedAmount === undefined ? {} : { amountCents: Number(row.parsedAmount) }),
    };
    const kind = kindOfRow(row);
    out.push({ id: `row-${row.seq}-${row.bidId}`, kind, ...base });
    if (kind === 'bid') {
      if (leader !== null && leader.bidderId !== row.bidderId) {
        out.push({
          id: `outbid-${row.seq}-${row.bidId}`,
          kind: 'outbid',
          at: base.at,
          row,
          paddle: leader.paddle,
          otherPaddle: paddle,
          ...(row.parsedAmount === undefined ? {} : { amountCents: Number(row.parsedAmount) }),
        });
      }
      leader = { paddle, bidderId: row.bidderId };
    }
  }
  const hammer = hammerOf(state);
  const lastAt = rows.length === 0 ? null : Number(rows[rows.length - 1]?.serverTs);
  const snap = state.snapshot;
  if (snap !== null && Number(snap.endTs) > Number(snap.config.endTs)) {
    const step = Number(snap.config.softCloseExtensionMs);
    out.push({
      id: 'extend',
      kind: 'extend',
      at: null,
      paddle: null,
      endTs: Number(snap.endTs),
      count:
        step > 0
          ? Math.max(1, Math.round((Number(snap.endTs) - Number(snap.config.endTs)) / step))
          : 1,
    });
  }
  if (state.snapshot?.paused === true && hammer === null) {
    out.push({ id: 'pause', kind: 'pause', at: null, paddle: null });
  }
  if (hammer !== null) {
    if (hammer.stopped)
      out.push({ id: 'stopped', kind: 'stopped', at: hammer.at ?? lastAt, paddle: null });
    out.push({
      id: 'hammer',
      kind: 'hammer',
      at: hammer.at ?? lastAt,
      paddle: hammer.winnerId === null ? null : paddleOf(hammer.winnerId),
      ...(hammer.winnerId === null ? {} : { amountCents: hammer.price }),
    });
    const counts = holdCounts(state);
    for (const s of SETTLE_ORDER) {
      const n = counts[s] ?? 0;
      if (n > 0)
        out.push({
          id: `settle-${s}`,
          kind: 'settlement',
          at: null,
          paddle: null,
          state: s,
          count: n,
        });
    }
    out.push({ id: 'receipt', kind: 'receipt', at: null, paddle: null });
  }
  return out;
}

export interface TrailSummary {
  lotTitle: string | null;
  /** The hammer price once sold, else the current leading price, else null. */
  priceCents: number | null;
  sold: boolean;
  bidders: number;
  acceptedBids: number;
  attempts: number;
  held: number;
  released: number;
  charged: number;
  status: 'scheduled' | 'open' | 'paused' | 'stopped' | 'sold' | 'passed';
}

export function summarize(state: RoomState): TrailSummary {
  const snap = state.snapshot;
  const hammer = hammerOf(state);
  const counts = holdCounts(state);
  const total = Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
  const released = (counts.SETTLED ?? 0) + (counts.VOIDING ?? 0);
  const charged = counts.CAPTURED ?? 0;
  let status: TrailSummary['status'] = 'open';
  if (hammer !== null)
    status = hammer.stopped ? 'stopped' : hammer.winnerId === null ? 'passed' : 'sold';
  else if (snap?.paused === true) status = 'paused';
  else if (snap?.status === 'SCHEDULED') status = 'scheduled';
  const price = hammer !== null ? hammer.price : (snap?.price ?? null);
  return {
    lotTitle: snap?.lotTitle ?? null,
    priceCents: price === null || price === undefined ? null : Number(price),
    sold: hammer !== null && hammer.winnerId !== null,
    bidders: snap?.roster.length ?? 0,
    acceptedBids: state.audit.filter((r) => r.outcome === 'accepted').length,
    attempts: state.audit.length,
    held: Math.max(0, total - released - charged),
    released,
    charged,
    status,
  };
}

/** A ledger row as a timeline line, for the detail view's one-sentence summary. */
export function entryOfRow(row: AuditPayload, paddle: number | null): TrailEntry {
  return {
    id: `row-${row.seq}`,
    kind: kindOfRow(row),
    at: Number(row.serverTs),
    row,
    paddle,
    source: row.source,
    ...(row.parsedAmount === undefined ? {} : { amountCents: Number(row.parsedAmount) }),
  };
}
