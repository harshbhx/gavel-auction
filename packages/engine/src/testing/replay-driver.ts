import type { Command } from '../commands.js';
import { decide } from '../decide/index.js';
import { evolve } from '../evolve.js';
import type { LedgerEntry, SettlementState } from '../events.js';
import { sealBatch } from '../ledger/chain.js';
import { pureHasher } from '../sha256.js';
import { initialState } from '../state.js';
import type { AuctionState } from '../state.js';
import type { AuctionConfig, BidSource, LotConfig, Mode, SoftClose, Ulid } from '../types.js';

/** A bidder of a scripted auction, named by a short key. */
export interface GalaBidder {
  key: string;
  ceilingCents: number;
  holdRef?: string;
}

/** A lot of a scripted auction; `incrementCents` is a flat increment. */
export interface GalaLot {
  key: string;
  title: string;
  mode: Mode;
  reserveCents: number;
  incrementCents: number;
  durationMs: number;
  softClose: SoftClose;
  hammer: 'auto' | 'manual';
}

/** One timed step of the script; `at` is the engine time of the command in epoch milliseconds. */
export type GalaStep =
  | { at: number; do: 'open'; lot: string }
  | {
      at: number;
      do: 'bid';
      lot: string;
      bidder: string;
      amountCents: number;
      source?: BidSource;
      confidenceBps?: number;
      confirmed?: boolean;
      transcript?: string;
    }
  | { at: number; do: 'tick' }
  | { at: number; do: 'hammer'; lot: string; early?: boolean }
  | {
      at: number;
      do: 'settle';
      lot: string;
      from: SettlementState;
      to: SettlementState;
      ref: string;
    }
  | { at: number; do: 'promote'; lot: string; bidder: string; reason: string }
  | { at: number; do: 'complete'; lot: string; bidder: string; capturedCents: number; ref: string }
  | { at: number; do: 'close' };

/** The scripted part of a gala fixture. */
export interface GalaScript {
  title: string;
  auctionConfig: Partial<AuctionConfig>;
  bidders: GalaBidder[];
  lots: GalaLot[];
  steps: GalaStep[];
}

/** What the fixture says a replay must produce. */
export interface GalaExpect {
  head: { seq: number; hash: string };
  /** Bid rejection reasons in ledger order. */
  rejects: string[];
  /** Lot key to the winner key and the price paid. */
  winners: Record<string, { bidder: string; priceCents: number }>;
  /** Lot key to the final settlement state. */
  settlement: Record<string, SettlementState>;
}

/** A fixture file: the golden fields every loader needs, plus the gala script and its result. */
export interface GalaFixture {
  name: string;
  parity: boolean;
  config: unknown;
  steps: unknown;
  expect: unknown;
  gala: GalaScript;
  galaExpect: GalaExpect;
}

/** An entry with the offset, in virtual milliseconds from the first command, at which to show it. */
export interface TimedEntry {
  offsetMs: number;
  entry: LedgerEntry;
}

export interface ScriptOptions {
  /** Playback speed; 2 shows the script twice as fast. Defaults to 1. */
  speed?: number;
  /**
   * Called with the virtual time to wait before the next entry. Omit it to get the entries at
   * once (tests); pass a timer based function to pace a live replay.
   */
  sleep?: (ms: number) => Promise<void>;
}

const hex = (prefix: string, n: number): Ulid =>
  `${prefix}${n.toString(16).toUpperCase()}`.padStart(26, '0') as Ulid;

/** The fixed ULIDs a script uses, so a replay is the same bytes every time. */
export interface GalaIds {
  auction: Ulid;
  lots: Map<string, Ulid>;
  bidders: Map<string, Ulid>;
}

export function galaIds(script: GalaScript): GalaIds {
  return {
    auction: hex('A', 1),
    lots: new Map(script.lots.map((l, i) => [l.key, hex('M', i + 1)])),
    bidders: new Map(script.bidders.map((b, i) => [b.key, hex('B', i + 1)])),
  };
}

function lookup(map: Map<string, Ulid>, key: string, what: string): Ulid {
  const v = map.get(key);
  if (v === undefined) throw new RangeError(`script names an unknown ${what} "${key}"`);
  return v;
}

/**
 * Compiles a script into the commands it stands for: auction, lots and bidders at time 0,
 * then one command per step. Command ids are numbered in order, so a bid id is stable.
 */
export function galaCommands(script: GalaScript): Command[] {
  const ids = galaIds(script);
  let n = 0;
  const base = (at: number): { commandId: Ulid; auctionId: Ulid; at: number } => {
    n += 1;
    return { commandId: hex('C', n), auctionId: ids.auction, at };
  };
  const lot = (key: string): Ulid => lookup(ids.lots, key, 'lot');
  const who = (key: string): Ulid => lookup(ids.bidders, key, 'bidder');
  const out: Command[] = [
    { ...base(0), type: 'CreateAuction', title: script.title, config: script.auctionConfig },
  ];
  for (const l of script.lots) {
    const config: LotConfig = {
      lotId: lot(l.key),
      title: l.title,
      mode: l.mode,
      reserveCents: l.reserveCents,
      increment: { flatCents: l.incrementCents },
      durationMs: l.durationMs,
      softClose: l.softClose,
      hammer: l.hammer,
    };
    out.push({ ...base(0), type: 'AddLot', lot: config });
  }
  for (const b of script.bidders) {
    const cmd: Command = {
      ...base(0),
      type: 'RegisterBidder',
      bidderId: who(b.key),
      ceilingCents: b.ceilingCents,
    };
    if (b.holdRef !== undefined) cmd.holdRef = b.holdRef;
    out.push(cmd);
  }
  for (const s of script.steps) {
    switch (s.do) {
      case 'open':
        out.push({ ...base(s.at), type: 'OpenLot', lotId: lot(s.lot) });
        break;
      case 'bid':
        out.push({
          ...base(s.at),
          type: 'PlaceBid',
          lotId: lot(s.lot),
          bidderId: who(s.bidder),
          amountCents: s.amountCents,
          source: s.source ?? 'manual',
          audit: {
            ...(s.confidenceBps === undefined ? {} : { confidenceBps: s.confidenceBps }),
            ...(s.confirmed === undefined ? {} : { confirmed: s.confirmed }),
            ...(s.transcript === undefined ? {} : { transcript: s.transcript }),
          },
        });
        break;
      case 'tick':
        out.push({ ...base(s.at), type: 'Tick' });
        break;
      case 'hammer': {
        const cmd: Command = {
          ...base(s.at),
          type: 'Hammer',
          lotId: lot(s.lot),
          actor: 'auctioneer',
        };
        if (s.early !== undefined) cmd.early = s.early;
        out.push(cmd);
        break;
      }
      case 'settle':
        out.push({
          ...base(s.at),
          type: 'RecordSettlement',
          lotId: lot(s.lot),
          from: s.from,
          to: s.to,
          ref: s.ref,
        });
        break;
      case 'promote':
        out.push({
          ...base(s.at),
          type: 'PromoteRunnerUp',
          lotId: lot(s.lot),
          disqualifiedBidderId: who(s.bidder),
          reason: s.reason,
        });
        break;
      case 'complete':
        out.push({
          ...base(s.at),
          type: 'CompleteLot',
          lotId: lot(s.lot),
          bidderId: who(s.bidder),
          capturedCents: s.capturedCents,
          ref: s.ref,
        });
        break;
      case 'close':
        out.push({ ...base(s.at), type: 'CloseAuction' });
        break;
    }
  }
  return out;
}

function checkSpeed(speed: number | undefined): number {
  const v = speed ?? 1;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new RangeError('speed must be a positive finite number');
  }
  return v;
}

/**
 * Runs the commands of a script through decide, seal and evolve, in order, and returns every
 * entry with the virtual offset of the command that produced it. Nothing here reads a clock:
 * the offsets come from the script times alone.
 */
export function playScript(
  f: GalaFixture,
  speed?: number,
): { timed: TimedEntry[]; state: AuctionState } {
  const factor = checkSpeed(speed);
  const commands = galaCommands(f.gala);
  const start = commands[0]?.at ?? 0;
  const timed: TimedEntry[] = [];
  let state: AuctionState = initialState;
  for (const cmd of commands) {
    const result = decide(state, cmd);
    const sealed = sealBatch(
      result.events,
      { auctionId: cmd.auctionId, seq: state.head.seq, hash: state.head.hash },
      cmd.at,
      cmd.commandId,
      pureHasher,
    );
    const offsetMs = Math.round((cmd.at - start) / factor);
    for (const entry of sealed) timed.push({ offsetMs, entry });
    state = sealed.reduce(evolve, state);
  }
  return { timed, state };
}

/**
 * Turns a fixture into timed entries for the web replay and the end-to-end runners (R-ENG-115).
 * The virtual clock is the script time divided by `speed`; with `sleep` the generator waits
 * the difference between two offsets before each entry, without it the entries come at once.
 */
export async function* runScript(
  f: GalaFixture,
  opts: ScriptOptions = {},
): AsyncIterable<TimedEntry> {
  const { timed } = playScript(f, opts.speed);
  let shown = 0;
  for (const item of timed) {
    if (opts.sleep !== undefined && item.offsetMs > shown) {
      await opts.sleep(item.offsetMs - shown);
      shown = item.offsetMs;
    }
    yield item;
  }
}
