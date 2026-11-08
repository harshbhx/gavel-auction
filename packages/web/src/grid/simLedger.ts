import { sealChain, type HashFn, type LedgerEntry } from './ledgerModel';

type Body = Omit<LedgerEntry, 'hash' | 'prev' | 'seq'>;

/** Small seeded generator (mulberry32), so the simulated run is the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIM_START = Date.UTC(2026, 8, 1, 0, 0, 0);
const DAY_MS = 86_400_000;

export interface SimOptions {
  days?: number;
  seed?: number;
  /** Bids per day, a range. */
  bidsPerDay?: readonly [number, number];
}

/**
 * Entry bodies for a simulated run of auctions, one a day: auction opened, holds placed, a stream of
 * accepted and rejected bids, the hammer, the winner settled and the other holds released. Amounts
 * are integer cents. Nothing here is real money or real people: it is a deterministic simulation.
 */
export function simulateBodies(options: SimOptions = {}): Body[] {
  const days = options.days ?? 30;
  const [lo, hi] = options.bidsPerDay ?? [40, 70];
  const rand = seeded(options.seed ?? 20261108);
  const out: Body[] = [];
  for (let day = 0; day < days; day += 1) {
    let at = SIM_START + day * DAY_MS + 18 * 3_600_000;
    const tick = (maxMs: number): number => {
      at += 200 + Math.floor(rand() * maxMs);
      return at;
    };
    const push = (b: Omit<Body, 'at' | 'note'> & { note?: string | null }, maxMs = 4000): void => {
      out.push({ at: tick(maxMs), note: null, ...b });
    };
    push({ type: 'auction_opened', actor: 'auctioneer', amountCents: null });
    const bidders = 4 + Math.floor(rand() * 5);
    for (let p = 1; p <= bidders; p += 1) {
      push({
        type: 'hold_placed',
        actor: `paddle:${p}`,
        amountCents: (100 + Math.floor(rand() * 150)) * 1000,
      });
    }
    let price = 2500 + Math.floor(rand() * 5000);
    let leader = 1;
    const bids = lo + Math.floor(rand() * (hi - lo + 1));
    for (let i = 0; i < bids; i += 1) {
      const paddle = 1 + Math.floor(rand() * bidders);
      const step = 500 * (1 + Math.floor(rand() * 4));
      const rejected = paddle === leader || rand() < 0.12;
      if (rejected) {
        push(
          {
            type: 'bid_rejected',
            actor: `paddle:${paddle}`,
            amountCents: price + step,
            note: paddle === leader ? 'already_leading' : 'below_increment',
          },
          6000,
        );
      } else {
        price += step;
        leader = paddle;
        push({ type: 'bid_accepted', actor: `paddle:${paddle}`, amountCents: price }, 6000);
      }
    }
    push({ type: 'hammer', actor: 'auctioneer', amountCents: price });
    push({ type: 'winner_settled', actor: 'system', amountCents: price, note: `paddle:${leader}` });
    for (let p = 1; p <= bidders; p += 1) {
      if (p !== leader)
        push({ type: 'hold_released', actor: `paddle:${p}`, amountCents: null }, 900);
    }
  }
  return out;
}

/** The simulated run as a sealed chain. */
export function simulateLedger(hash: HashFn, options: SimOptions = {}): Promise<LedgerEntry[]> {
  return sealChain(simulateBodies(options), hash);
}

export interface SimHold {
  /** Unique within the run. */
  id: string;
  day: number;
  paddle: number;
  state: 'HELD' | 'SETTLED' | 'CAPTURED';
  heldCents: number;
  capturedCents: number;
  releasedCents: number;
}

/** Holds and their settlement outcome per simulated day, read back from the entry bodies. */
export function holdsFromBodies(bodies: readonly Body[]): SimHold[] {
  const holds: SimHold[] = [];
  let day = -1;
  let current: SimHold[] = [];
  let winner = -1;
  let price = 0;
  const flush = (): void => {
    for (const h of current) {
      if (h.paddle === winner) {
        h.state = 'CAPTURED';
        h.capturedCents = Math.min(price, h.heldCents);
        h.releasedCents = h.heldCents - h.capturedCents;
      } else {
        h.state = 'SETTLED';
        h.releasedCents = h.heldCents;
      }
    }
    holds.push(...current);
    current = [];
  };
  for (const b of bodies) {
    const paddle = b.actor?.startsWith('paddle:') === true ? Number(b.actor.slice(7)) : 0;
    if (b.type === 'auction_opened') {
      flush();
      day += 1;
      winner = -1;
    } else if (b.type === 'hold_placed') {
      current.push({
        id: `d${day + 1}-p${paddle}`,
        day: day + 1,
        paddle,
        state: 'HELD',
        heldCents: b.amountCents ?? 0,
        capturedCents: 0,
        releasedCents: 0,
      });
    } else if (b.type === 'winner_settled') {
      winner = Number((b.note ?? 'paddle:0').slice(7));
      price = b.amountCents ?? 0;
    }
  }
  flush();
  return holds;
}
