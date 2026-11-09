import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decide, evolve, initialState } from '@gavel/engine';
import type { AuctionState, Command, LedgerEntry, LotConfig, Mode, Ulid } from '@gavel/engine';
import { propertyParams } from '../../src/property/harness';

// T-QA-021: price monotonic, winner = max accepted, ties by earliest server time then
// arrival order, soft close never shortens, no accepted bid above the bidder ceiling.

// fc.assert with the shared reporter prints but does not throw, so run the check and throw.
function assertProp<T extends unknown[]>(prop: fc.IPropertyWithHooks<T>): void {
  const d = fc.check(prop, propertyParams());
  if (d.failed) {
    throw new Error(
      `property failed, replay with GAVEL_PROPERTY_SEED=${String(d.seed)}: ${JSON.stringify(d.counterexample)} ${String(d.errorInstance)}`,
    );
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const id = (n: number): Ulid => {
  let rest = n;
  let s = '';
  while (s.length < 26) {
    s = CROCKFORD.charAt(rest % 32) + s;
    rest = Math.floor(rest / 32);
  }
  return s as Ulid;
};

const AUCTION = id(1);
const LOT = id(2);
const BIDDERS: readonly Ulid[] = [id(10), id(11), id(12)];
const CEILING = 90_000;
const RESERVE = 1000;
const INCREMENT = 100;
const SOFT_WINDOW = 5000;
const SOFT_EXT = 5000;

let nextCmd = 100;
const mk = (at: number, body: Record<string, unknown>): Command =>
  ({ commandId: id((nextCmd += 1)), auctionId: AUCTION, at, ...body }) as unknown as Command;

function apply(
  state: AuctionState,
  cmd: Command,
): { state: AuctionState; accepted: boolean; rejected: boolean } {
  const res = decide(state, cmd);
  const entries = res.events.map(
    (e, i) =>
      ({
        v: 1,
        auctionId: AUCTION,
        seq: state.head.seq + 1 + i,
        at: cmd.at,
        type: e.type,
        cmd: cmd.commandId,
        payload: e.payload,
        prev: 'p',
        hash: `h${state.head.seq + 1 + i}`,
      }) as unknown as LedgerEntry,
  );
  return {
    state: entries.reduce(evolve, state),
    accepted: res.outcome.kind === 'accepted',
    rejected: res.outcome.kind === 'rejected',
  };
}

function lotConfig(mode: Mode): LotConfig {
  return {
    lotId: LOT,
    title: 'Vase',
    mode,
    reserveCents: RESERVE,
    increment: { flatCents: INCREMENT },
    durationMs: 10_000,
    softClose: {
      windowMs: mode === 'second_price' ? 0 : SOFT_WINDOW,
      extensionMs: mode === 'second_price' ? 0 : SOFT_EXT,
      maxExtensions: 3,
    },
    hammer: 'auto',
  };
}

function scene(mode: Mode): AuctionState {
  let s = initialState;
  s = apply(s, mk(0, { type: 'CreateAuction', title: 'Gala', config: {} })).state;
  s = apply(s, mk(0, { type: 'AddLot', lot: lotConfig(mode) })).state;
  for (const b of BIDDERS) {
    s = apply(s, mk(0, { type: 'RegisterBidder', bidderId: b, ceilingCents: CEILING })).state;
  }
  return apply(s, mk(100, { type: 'OpenLot', lotId: LOT })).state;
}

interface BidInput {
  readonly dt: number;
  readonly bidder: number;
  /** Offset from the current minimum next bid, so the boundary is probed often. */
  readonly delta: number;
}

const bidInput: fc.Arbitrary<BidInput> = fc.record({
  dt: fc.integer({ min: 0, max: 1500 }),
  bidder: fc.integer({ min: 0, max: BIDDERS.length - 1 }),
  delta: fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(-1, 0, 1, -INCREMENT, INCREMENT) },
    { weight: 1, arbitrary: fc.integer({ min: -2000, max: 100_000 }) },
  ),
});
const bidSequence = fc.array(bidInput, { minLength: 1, maxLength: 30 });

interface Step {
  readonly at: number;
  readonly bidder: Ulid;
  /** Amount the caller meant to bid (before any seeded bug skews it). */
  readonly claimed: number;
  readonly accepted: boolean;
  readonly priceBefore: number | null;
  readonly endsBefore: number | null;
  readonly endsAfter: number | null;
  readonly seq: number;
}

interface Trace {
  readonly steps: Step[];
  readonly final: AuctionState;
}

/** `skew` models a broken engine: the engine sees the amount shifted by that many cents. */
function simulate(mode: Mode, bids: readonly BidInput[], skew = 0): Trace {
  let s = scene(mode);
  let at = 200;
  const steps: Step[] = [];
  for (const b of bids) {
    at += b.dt;
    const bidder = BIDDERS[b.bidder] as Ulid;
    const lotBefore = s.lots[LOT];
    const minNext = lotBefore?.priceCents == null ? RESERVE : lotBefore.priceCents + INCREMENT;
    const amount = Math.max(1, minNext + b.delta);
    const r = apply(
      s,
      mk(at, {
        type: 'PlaceBid',
        lotId: LOT,
        bidderId: bidder,
        amountCents: amount + skew,
        source: 'manual',
        audit: {},
      }),
    );
    steps.push({
      at,
      bidder,
      claimed: amount,
      accepted: r.accepted,
      priceBefore: lotBefore?.priceCents ?? null,
      endsBefore: lotBefore?.endsAt ?? null,
      endsAfter: r.state.lots[LOT]?.endsAt ?? null,
      seq: s.head.seq + 1,
    });
    s = r.state;
  }
  return { steps, final: s };
}

/** Violations of the english-auction invariants in one trace. Empty means all hold. */
function englishViolations(t: Trace): string[] {
  const out: string[] = [];
  let top = 0;
  for (const st of t.steps) {
    const minNext = st.priceBefore === null ? RESERVE : st.priceBefore + INCREMENT;
    if (st.accepted) {
      if (st.claimed < minNext) out.push(`accepted ${st.claimed} below minimum ${minNext}`);
      if (st.claimed <= top) out.push(`price not strictly increasing at ${st.claimed}`);
      if (st.claimed > CEILING) out.push(`accepted ${st.claimed} above ceiling`);
      top = Math.max(top, st.claimed);
    } else if (st.priceBefore !== null && st.claimed === st.priceBefore) {
      // A tie with the standing price never replaces the earlier bid.
      if (st.endsAfter !== st.endsBefore) out.push('rejected tie moved the end time');
    }
    if (st.endsBefore !== null && st.endsAfter !== null && st.endsAfter < st.endsBefore) {
      out.push(`end time shortened from ${st.endsBefore} to ${st.endsAfter}`);
    }
  }
  return out;
}

type RaiseOp =
  | { readonly kind: 'bid'; readonly dt: number; readonly bidder: number; readonly delta: number }
  | { readonly kind: 'raise'; readonly dt: number; readonly bidder: number; readonly to: number };

const raiseOp: fc.Arbitrary<RaiseOp> = fc.oneof(
  bidInput.map((b): RaiseOp => ({ kind: 'bid', ...b })),
  fc.record({
    kind: fc.constant('raise' as const),
    dt: fc.integer({ min: 0, max: 1500 }),
    bidder: fc.integer({ min: 0, max: BIDDERS.length - 1 }),
    // Below, at and above the current ceiling, up to the engine default cap of 100000.
    to: fc.oneof(
      fc.constantFrom(CEILING - 1, CEILING, CEILING + 1),
      fc.integer({ min: 100, max: 100_000 }),
    ),
  }),
);

describe('ceiling raises (#2410)', () => {
  it('a limit never decreases, bids stay in the latest limit, the hammer price fits the winner', () => {
    assertProp(
      fc.property(fc.array(raiseOp, { minLength: 1, maxLength: 40 }), (ops) => {
        let s = scene('english');
        let at = 200;
        for (const op of ops) {
          at += op.dt;
          const bidder = BIDDERS[op.bidder] as Ulid;
          const before = s.bidders[bidder]?.ceilingCents ?? 0;
          if (op.kind === 'raise') {
            const r = apply(
              s,
              mk(at, { type: 'RegisterBidder', bidderId: bidder, ceilingCents: op.to }),
            );
            // Only a strictly larger limit is taken.
            expect(r.accepted).toBe(op.to > before);
            s = r.state;
          } else {
            const lot = s.lots[LOT];
            const minNext = lot?.priceCents == null ? RESERVE : lot.priceCents + INCREMENT;
            const amount = Math.max(1, minNext + op.delta);
            const r = apply(
              s,
              mk(at, {
                type: 'PlaceBid',
                lotId: LOT,
                bidderId: bidder,
                amountCents: amount,
                source: 'manual',
                audit: {},
              }),
            );
            if (r.accepted) expect(amount).toBeLessThanOrEqual(before);
            s = r.state;
          }
          const after = s.bidders[bidder]?.ceilingCents ?? 0;
          expect(after).toBeGreaterThanOrEqual(before);
        }
        const done = apply(
          s,
          mk(at + 1, { type: 'Hammer', lotId: LOT, early: true, actor: 'host' }),
        ).state;
        const lot = done.lots[LOT];
        if (lot?.winnerId != null && lot.priceCents != null) {
          expect(lot.priceCents).toBeLessThanOrEqual(done.bidders[lot.winnerId]?.ceilingCents ?? 0);
        }
      }),
    );
  });
});

describe('engine invariants (T-QA-021)', () => {
  it('english: price strictly increases, no bid above ceiling, soft close never shortens', () => {
    assertProp(
      fc.property(bidSequence, (bids) => {
        const v = englishViolations(simulate('english', bids));
        expect(v).toEqual([]);
      }),
    );
  });

  it('english: the hammer winner holds the maximum accepted bid, earliest first on ties', () => {
    assertProp(
      fc.property(bidSequence, (bids) => {
        const t = simulate('english', bids);
        const acc = t.steps.filter((st) => st.accepted);
        const lastAt = t.steps.reduce((m, st) => Math.max(m, st.at), 200);
        const done = apply(
          t.final,
          mk(lastAt + 1, { type: 'Hammer', lotId: LOT, early: true, actor: 'host' }),
        ).state;
        const lot = done.lots[LOT];
        if (acc.length === 0) {
          expect(lot?.winnerId ?? null).toBeNull();
          return;
        }
        const best = acc.reduce((m, st) => (st.claimed > m.claimed ? st : m));
        expect(lot?.priceCents).toBe(best.claimed);
        expect(lot?.winnerId).toBe(best.bidder);
      }),
    );
  });

  it('second price: the winner is the top accepted bid, ties by earliest time then arrival', () => {
    assertProp(
      fc.property(bidSequence, (bids) => {
        const t = simulate('second_price', bids);
        const accepted = t.steps.filter((st) => st.accepted);
        for (const st of accepted) expect(st.claimed).toBeLessThanOrEqual(CEILING);
        // A sealed top bid under the reserve does not win.
        const acc = accepted.filter((st) => st.claimed >= RESERVE);
        const lastAt = t.steps.reduce((m, st) => Math.max(m, st.at), 200);
        const done = apply(
          t.final,
          mk(lastAt + 1, { type: 'Hammer', lotId: LOT, early: true, actor: 'host' }),
        ).state;
        const winner = done.lots[LOT]?.winnerId ?? null;
        if (acc.length === 0) {
          expect(winner).toBeNull();
          return;
        }
        const better = (a: Step, b: Step): boolean =>
          a.claimed !== b.claimed
            ? a.claimed > b.claimed
            : a.at !== b.at
              ? a.at < b.at
              : a.seq < b.seq;
        const top = acc.reduce((m, st) => (better(st, m) ? st : m));
        expect(winner).toBe(top.bidder);
      }),
    );
  });

  it('a seeded off-by-one increment is caught within 200 cases', () => {
    const detail = fc.check(
      fc.property(
        bidSequence,
        (bids) => englishViolations(simulate('english', bids, 1)).length === 0,
      ),
      propertyParams({ seed: 20261105 }),
    );
    expect(detail.failed).toBe(true);
  });
});
