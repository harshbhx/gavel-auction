/**
 * Legacy single-lot `Auction` API (register, placeBid, hammer, complete) running on the
 * decide/evolve core (R-ENG-116). Times are seconds and are mapped to epoch milliseconds,
 * money is the same integer unit as before, and bidder names are mapped to ULIDs.
 *
 * Modes:
 *  english      ascending open outcry; each bid >= price + minIncrement; winner pays top bid.
 *  proxy        bids are max-bids; price = min(topMax, secondMax + inc), at least reserve.
 *  second_price sealed, one bid per bidder; winner pays max(reserve, second-highest bid).
 * Ties on amount: earliest timestamp wins, then arrival sequence. Bids above the
 * bidder's authorised ceiling are rejected. States: OPEN -> CLOSING -> SETTLING -> DONE.
 */
import type { Command } from './commands.js';
import { decide } from './decide/index.js';
import { EngineError } from './errors.js';
import { evolve } from './evolve.js';
import type { LedgerEntry } from './events.js';
import { sealBatch } from './ledger/chain.js';
import { monotonicAt } from './clock.js';
import { currentPrice as basicPrice } from './rules/pricing-basic.js';
import type { PricingLot } from './rules/pricing-basic.js';
import { currentPrice as proxyPrice } from './rules/pricing-proxy.js';
import { rank } from './rules/ranking.js';
import { initialState } from './state.js';
import type { AuctionState, LotState } from './state.js';
import { MAX_AMOUNT_CENTS } from './types.js';
import type { Ulid } from './types.js';

export type Mode = 'english' | 'proxy' | 'second_price';
export type State = 'OPEN' | 'CLOSING' | 'SETTLING' | 'DONE';

export class Rejected extends Error {
  constructor(
    public readonly code: string,
    msg = '',
  ) {
    super(`${code}: ${msg}`);
  }
}

export interface Bid {
  bidder: string;
  amount: number;
  ts: number;
  seq: number;
}

export interface Outcome {
  winner: string | null;
  price: number;
  ranking: Array<[string, number]>;
}

export interface AuctionOptions {
  mode?: Mode;
  reserve?: number;
  minIncrement?: number;
  endTs?: number;
  softCloseWindow?: number;
  softCloseExtension?: number;
  maxExtensions?: number;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministic 26 character id: a kind letter, then the counter in Crockford base 32. */
function ulid(kind: string, n: number): Ulid {
  let digits = '';
  let rest = n;
  do {
    digits = (CROCKFORD[rest % 32] ?? '0') + digits;
    rest = Math.floor(rest / 32);
  } while (rest > 0);
  return `${kind}${digits}`.padStart(26, '0') as Ulid;
}

type Body = Command extends infer C
  ? C extends Command
    ? Omit<C, 'commandId' | 'auctionId' | 'at'>
    : never
  : never;

const toMs = (seconds: number): number => Math.round(seconds * 1000);

export class Auction {
  readonly mode: Mode;
  readonly reserve: number;
  readonly inc: number;
  readonly ceilings = new Map<string, number>();
  outcome: Outcome | null = null;
  private core: AuctionState = initialState;
  private readonly auctionId: Ulid;
  private readonly lotId: Ulid;
  private commandCount = 0;
  private completed = false;
  private readonly ids = new Map<string, Ulid>();
  private readonly names = new Map<string, string>();

  constructor(
    readonly id: string,
    opts: AuctionOptions = {},
  ) {
    this.mode = opts.mode ?? 'english';
    this.reserve = opts.reserve ?? 1;
    this.inc = opts.minIncrement ?? 1;
    if (this.reserve < 1 || this.inc < 1) throw new Error('reserve and increment must be >= 1');
    const sealed = this.mode === 'second_price';
    const window = sealed ? 0 : toMs(opts.softCloseWindow ?? 0);
    const extension = sealed ? 0 : toMs(opts.softCloseExtension ?? 0);
    this.auctionId = ulid('A', 1);
    this.lotId = ulid('L', 1);
    this.exec({
      type: 'CreateAuction',
      title: id.slice(0, 120) || 'auction',
      config: { maxCeilingCents: MAX_AMOUNT_CENTS },
    });
    this.exec({
      type: 'AddLot',
      lot: {
        lotId: this.lotId,
        title: 'lot',
        mode: this.mode,
        reserveCents: this.reserve,
        increment: { flatCents: this.inc },
        durationMs: Math.max(1000, toMs(opts.endTs ?? 100)),
        softClose: {
          windowMs: window,
          extensionMs: extension,
          maxExtensions: Math.min(50, opts.maxExtensions ?? 10),
        },
        hammer: 'auto',
      },
    });
    this.exec({ type: 'OpenLot', lotId: this.lotId });
  }

  private get lot(): LotState {
    const lot = this.core.lots[this.lotId];
    if (lot === undefined) throw new Error('legacy lot missing');
    return lot;
  }

  private idOf(name: string): Ulid {
    let u = this.ids.get(name);
    if (u === undefined) {
      u = ulid('B', this.ids.size + 1);
      this.ids.set(name, u);
      this.names.set(u, name);
    }
    return u;
  }

  private nameOf(bidderId: string): string {
    return this.names.get(bidderId) ?? bidderId;
  }

  /** Decides, seals and applies one command; engine errors surface as `Rejected`. */
  private exec(body: Body, ms = 0): LedgerEntry[] {
    this.commandCount += 1;
    const at = monotonicAt(ms, this.core.head.at);
    const cmd = {
      ...body,
      commandId: ulid('C', this.commandCount),
      auctionId: this.auctionId,
      at,
    } as Command;
    try {
      const result = decide(this.core, cmd);
      const entries = sealBatch(
        result.events,
        { auctionId: this.auctionId, seq: this.core.head.seq, hash: this.core.head.hash },
        at,
        cmd.commandId,
      );
      this.core = entries.reduce(evolve, this.core);
      if (result.outcome.kind === 'rejected') throw new Rejected(result.outcome.reason);
      return entries;
    } catch (e) {
      if (e instanceof EngineError) {
        throw new Rejected(e.code === 'lot_done' ? 'closed' : e.code, e.message);
      }
      throw e;
    }
  }

  private get pricing(): PricingLot {
    return { mode: this.mode, reserveCents: this.reserve, increment: { flatCents: this.inc } };
  }

  get state(): State {
    const lot = this.lot;
    if (lot.status === 'DONE' && lot.unsoldReason !== null && !this.completed) return 'SETTLING';
    return lot.status === 'PENDING' ? 'OPEN' : lot.status;
  }

  get endTs(): number {
    return (this.lot.endsAt ?? 0) / 1000;
  }

  get extensions(): number {
    return this.lot.extensions;
  }

  get bids(): Bid[] {
    return this.lot.bids.map((b) => ({
      bidder: this.nameOf(b.bidderId),
      amount: b.amountCents,
      ts: b.at / 1000,
      seq: b.seq,
    }));
  }

  register(bidder: string, ceiling: number): void {
    if (this.state !== 'OPEN') throw new Rejected('not_open');
    if (!Number.isInteger(ceiling) || ceiling < 1) throw new Rejected('bad_ceiling');
    this.exec({ type: 'RegisterBidder', bidderId: this.idOf(bidder), ceilingCents: ceiling });
    this.ceilings.set(bidder, ceiling);
  }

  ranking(): Array<[string, number]> {
    return rank(this.lot.bids).map((r) => [this.nameOf(r.bidderId), r.amountCents]);
  }

  price(): number | null {
    if (this.mode === 'second_price') return null;
    const ranked = rank(this.lot.bids);
    return this.mode === 'english'
      ? basicPrice(this.pricing, ranked)
      : proxyPrice(this.pricing, ranked);
  }

  leader(): string | null {
    const id = this.lot.leaderId;
    return id === null ? null : this.nameOf(id);
  }

  tick(now: number): State {
    const ms = toMs(now);
    const endsAt = this.lot.endsAt;
    if (this.state === 'OPEN' && endsAt !== null && ms >= endsAt) this.exec({ type: 'Tick' }, ms);
    return this.state;
  }

  placeBid(bidder: string, amount: number, ts: number) {
    this.tick(ts);
    if (this.state !== 'OPEN') throw new Rejected('closed');
    this.exec(
      {
        type: 'PlaceBid',
        lotId: this.lotId,
        bidderId: this.idOf(bidder),
        amountCents: amount,
        source: 'manual',
        audit: {},
      },
      toMs(ts),
    );
    return { price: this.price(), leader: this.leader(), endTs: this.endTs };
  }

  hammer(now: number): Outcome {
    this.tick(now);
    if (this.state !== 'CLOSING') throw new Rejected('cannot_hammer', this.state);
    const entries = this.exec({ type: 'Hammer', lotId: this.lotId, actor: 'legacy' }, toMs(now));
    const sold = entries.find((e) => e.type === 'LOT_HAMMERED');
    const out: Outcome =
      sold === undefined || sold.type !== 'LOT_HAMMERED'
        ? { winner: null, price: 0, ranking: [] }
        : {
            winner: this.nameOf(sold.payload.winnerId),
            price: sold.payload.priceCents,
            ranking: sold.payload.ranking.map((r) => [this.nameOf(r.bidderId), r.amountCents]),
          };
    this.outcome = out;
    return out;
  }

  complete(): void {
    if (this.state !== 'SETTLING') throw new Rejected('cannot_complete', this.state);
    const price = this.lot.priceCents;
    if (price !== null) {
      this.exec({ type: 'CompleteLot', lotId: this.lotId, capturedCents: price, ref: 'legacy' });
    }
    this.completed = true;
  }
}
