import type { Command } from '../src/commands.js';
import { decide } from '../src/decide/index.js';
import type { DecideResult } from '../src/decide/index.js';
import { evolve } from '../src/evolve.js';
import type { LedgerEntry } from '../src/events.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { LotConfig, Ulid } from '../src/types.js';

export const id = (s: string): Ulid => s.padStart(26, '0') as Ulid;
export const AU = id('AAA');
export const L1 = id('M1');
export const L2 = id('M2');
export const A = id('BA');
export const B = id('BB');
export const C = id('BC');

export const lotConfig = (lotId: Ulid, over: Partial<LotConfig> = {}): LotConfig => ({
  lotId,
  title: 'Vase',
  mode: 'english',
  reserveCents: 1000,
  increment: { flatCents: 100 },
  durationMs: 10000,
  softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 3 },
  hammer: 'auto',
  ...over,
});

let counter = 0;
export const nextId = (): Ulid => id(`C${(counter += 1).toString(16).toUpperCase()}X`);

export type Body = Command extends infer C
  ? C extends Command
    ? Omit<C, 'commandId' | 'auctionId' | 'at'>
    : never
  : never;

export function mk(at: number, body: Body, commandId: Ulid = nextId()): Command {
  return { commandId, auctionId: AU, at, ...body } as unknown as Command;
}

export function seal(s: AuctionState, cmd: Command, r: DecideResult): LedgerEntry[] {
  return r.events.map(
    (e, i) =>
      ({
        v: 1,
        auctionId: AU,
        seq: s.head.seq + 1 + i,
        at: cmd.at,
        type: e.type,
        cmd: cmd.commandId,
        payload: e.payload,
        prev: 'p',
        hash: `h${s.head.seq + 1 + i}`,
      }) as unknown as LedgerEntry,
  );
}

/** Decides a command and folds the resulting entries into state. */
export function run(
  s: AuctionState,
  cmd: Command,
): { state: AuctionState; result: DecideResult; entries: LedgerEntry[] } {
  const result = decide(s, cmd);
  const entries = seal(s, cmd, result);
  return { state: entries.reduce(evolve, s), result, entries };
}

export interface Scene {
  lots?: LotConfig[];
  config?: Record<string, unknown>;
}

/** Auction with lots, bidders A, B, C (ceiling 90000) and every lot still pending. */
export function scene(o: Scene = {}): AuctionState {
  let s = initialState;
  s = run(s, mk(0, { type: 'CreateAuction', title: 'Gala', config: o.config ?? {} })).state;
  for (const lot of o.lots ?? [lotConfig(L1)]) {
    s = run(s, mk(0, { type: 'AddLot', lot })).state;
  }
  for (const b of [A, B, C]) {
    s = run(s, mk(0, { type: 'RegisterBidder', bidderId: b, ceilingCents: 90000 })).state;
  }
  return s;
}

export function open(s: AuctionState, lotId: Ulid, at = 100): AuctionState {
  return run(s, mk(at, { type: 'OpenLot', lotId })).state;
}

export function bid(
  s: AuctionState,
  at: number,
  bidderId: Ulid,
  amountCents: number,
  lotId: Ulid = L1,
  extra: Partial<Extract<Command, { type: 'PlaceBid' }>> = {},
): ReturnType<typeof run> {
  return run(
    s,
    mk(at, {
      type: 'PlaceBid',
      lotId,
      bidderId,
      amountCents,
      source: 'manual',
      audit: {},
      ...extra,
    }),
  );
}

export function errCode(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Error && 'code' in e) return String((e as { code: unknown }).code);
    throw e;
  }
  return 'none';
}

/** Records the payment saga up to CAPTURED for a hammered lot, all at time `at`. */
export function captured(s: AuctionState, at: number, lotId: Ulid = L1): AuctionState {
  const path = ['HELD', 'BIDDING', 'WINNER_SELECTED', 'CAPTURING', 'CAPTURED'] as const;
  let cur = s;
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    if (from === undefined || to === undefined) break;
    cur = run(cur, mk(at, { type: 'RecordSettlement', lotId, from, to, ref: `saga-${i}` })).state;
  }
  return cur;
}
