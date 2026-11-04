/**
 * GAVEL deterministic auction engine. Money is integer minor units (cents).
 * Port of reference/python/engine.py.
 *
 * Modes:
 *  english      ascending open outcry; each bid >= price + minIncrement; winner pays top bid.
 *  proxy        bids are max-bids; price = min(topMax, secondMax + inc), at least reserve.
 *  second_price sealed, one bid per bidder; winner pays max(reserve, second-highest bid).
 * Ties on amount: earliest timestamp wins, then arrival sequence. Bids above the
 * bidder's authorised ceiling are rejected. States: OPEN -> CLOSING -> SETTLING -> DONE.
 */
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

export class Auction {
  readonly mode: Mode;
  readonly reserve: number;
  readonly inc: number;
  endTs: number;
  extensions = 0;
  state: State = 'OPEN';
  readonly ceilings = new Map<string, number>();
  readonly bids: Bid[] = [];
  outcome: Outcome | null = null;
  private seq = 0;
  private readonly window: number;
  private readonly ext: number;
  private readonly maxExt: number;

  constructor(
    readonly id: string,
    opts: AuctionOptions = {},
  ) {
    this.mode = opts.mode ?? 'english';
    this.reserve = opts.reserve ?? 1;
    this.inc = opts.minIncrement ?? 1;
    if (this.reserve < 1 || this.inc < 1) throw new Error('reserve and increment must be >= 1');
    this.endTs = opts.endTs ?? 100;
    this.window = opts.softCloseWindow ?? 0;
    this.ext = opts.softCloseExtension ?? 0;
    this.maxExt = opts.maxExtensions ?? 10;
  }

  register(bidder: string, ceiling: number): void {
    if (this.state !== 'OPEN') throw new Rejected('not_open');
    if (!Number.isInteger(ceiling) || ceiling < 1) throw new Rejected('bad_ceiling');
    this.ceilings.set(bidder, ceiling);
  }

  private best(): Map<string, Bid> {
    const best = new Map<string, Bid>();
    for (const b of this.bids) {
      const cur = best.get(b.bidder);
      if (!cur || b.amount > cur.amount || (b.amount === cur.amount && (b.ts < cur.ts || (b.ts === cur.ts && b.seq < cur.seq)))) {
        best.set(b.bidder, b);
      }
    }
    return best;
  }

  ranking(): Array<[string, number]> {
    return [...this.best().values()]
      .sort((a, b) => b.amount - a.amount || a.ts - b.ts || a.seq - b.seq)
      .map((b) => [b.bidder, b.amount]);
  }

  price(): number | null {
    if (this.mode === 'second_price') return null;
    const r = this.ranking();
    const [first, second] = r;
    if (!first) return null;
    if (this.mode === 'english') return first[1];
    if (!second) return this.reserve;
    return Math.max(this.reserve, Math.min(first[1], second[1] + this.inc));
  }

  leader(): string | null {
    return this.ranking()[0]?.[0] ?? null;
  }

  tick(now: number): State {
    if (this.state === 'OPEN' && now >= this.endTs) this.state = 'CLOSING';
    return this.state;
  }

  placeBid(bidder: string, amount: number, ts: number) {
    this.tick(ts);
    if (this.state !== 'OPEN') throw new Rejected('closed');
    const ceiling = this.ceilings.get(bidder);
    if (ceiling === undefined) throw new Rejected('unregistered');
    if (!Number.isInteger(amount) || amount <= 0) throw new Rejected('bad_amount');
    if (amount > ceiling) throw new Rejected('over_ceiling', `${amount} > ${ceiling}`);
    if (amount < this.reserve) throw new Rejected('below_reserve');
    const own = this.best().get(bidder);
    if (this.mode === 'english') {
      const p = this.price();
      if (p !== null && amount < p + this.inc) throw new Rejected('below_increment');
      if (this.leader() === bidder) throw new Rejected('already_leading');
    } else if (this.mode === 'proxy') {
      if (own && amount <= own.amount) throw new Rejected('not_higher_than_own_max');
    } else if (own) {
      throw new Rejected('already_bid');
    }
    this.seq += 1;
    this.bids.push({ bidder, amount, ts, seq: this.seq });
    if (
      this.mode !== 'second_price' &&
      this.window &&
      this.ext &&
      ts >= this.endTs - this.window &&
      this.extensions < this.maxExt
    ) {
      this.endTs = Math.max(this.endTs, ts + this.ext);
      this.extensions += 1;
    }
    return { price: this.price(), leader: this.leader(), endTs: this.endTs };
  }

  hammer(now: number): Outcome {
    this.tick(now);
    if (this.state !== 'CLOSING') throw new Rejected('cannot_hammer', this.state);
    const r = this.ranking();
    const [first, second] = r;
    let out: Outcome;
    if (!first) {
      out = { winner: null, price: 0, ranking: [] };
    } else {
      let price: number;
      if (this.mode === 'english') price = first[1];
      else if (this.mode === 'proxy') price = this.price() as number;
      else price = second ? Math.max(this.reserve, second[1]) : this.reserve;
      const cap = this.ceilings.get(first[0]) as number;
      if (price > cap) throw new Error('engine invariant violated: price <= ceiling');
      out = { winner: first[0], price, ranking: r };
    }
    this.outcome = out;
    this.state = 'SETTLING';
    return out;
  }

  complete(): void {
    if (this.state !== 'SETTLING') throw new Rejected('cannot_complete', this.state);
    this.state = 'DONE';
  }
}
