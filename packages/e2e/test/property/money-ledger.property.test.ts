import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Cents, GavelError, add, isCents, sub } from '@gavel/shared';
import {
  AuctionRuntime,
  EngineError,
  InMemoryLedgerStore,
  replay,
  stateDigest,
} from '@gavel/engine';
import type { Command, Ulid } from '@gavel/engine';
import { propertyParams } from '../../src/property/harness';

// T-QA-022: integer-cent arithmetic. The shared money module reports a non-integer amount
// as GavelError code bad_amount (the spec text calls it MONEY_NOT_INTEGER).
// T-QA-023: replaying the ledger entries from empty equals the live state.

// fc.assert with the shared reporter prints but does not throw, so run the check and throw.
function fail(d: fc.RunDetails<unknown[]>): never {
  throw new Error(
    `property failed, replay with FC_SEED=${String(d.seed)}: ${JSON.stringify(d.counterexample)} ${String(d.errorInstance)}`,
  );
}

function assertProp<T extends unknown[]>(prop: fc.IPropertyWithHooks<T>): void {
  const d = fc.check(prop, propertyParams());
  if (d.failed) fail(d);
}

async function assertAsyncProp<T extends unknown[]>(
  prop: fc.IAsyncPropertyWithHooks<T>,
): Promise<void> {
  const d = await fc.check(prop, propertyParams());
  if (d.failed) fail(d);
}

const cents = fc.integer({ min: 0, max: 1_000_000_000 });

describe('money (T-QA-022)', () => {
  it('add(a, b) - b equals a for integer cents in [0, 1e9]', () => {
    assertProp(
      fc.property(cents, cents, (a, b) => {
        const sum = add(Cents(a), Cents(b));
        expect(sub(sum, Cents(b))).toBe(a);
      }),
    );
  });

  it('any non-integer amount fails loudly', () => {
    const nonInteger = fc.oneof(
      fc.double({ noInteger: true, noNaN: true, min: -1e9, max: 1e9 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    );
    assertProp(
      fc.property(nonInteger, (x) => {
        expect(isCents(x)).toBe(false);
        let code: string | undefined;
        try {
          Cents(x);
        } catch (e) {
          if (e instanceof GavelError) code = e.code;
        }
        expect(code).toBe('bad_amount');
      }),
    );
  });

  it('a subtraction below zero throws instead of going negative', () => {
    assertProp(
      fc.property(cents, fc.integer({ min: 1, max: 1_000_000_000 }), (a, d) => {
        expect(() => sub(Cents(a), Cents(a + d))).toThrow(GavelError);
      }),
    );
  });
});

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
const FIXED_NOW = 1_000_000;

type Op =
  | { readonly kind: 'bid'; readonly dt: number; readonly bidder: number; readonly amount: number }
  | { readonly kind: 'tick'; readonly dt: number }
  | { readonly kind: 'revoke'; readonly dt: number; readonly bidder: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('bid' as const),
      dt: fc.integer({ min: 0, max: 800 }),
      bidder: fc.integer({ min: 0, max: BIDDERS.length - 1 }),
      amount: fc.integer({ min: 900, max: 8000 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('tick' as const),
      dt: fc.integer({ min: 0, max: 5000 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('revoke' as const),
      dt: fc.integer({ min: 0, max: 800 }),
      bidder: fc.integer({ min: 0, max: BIDDERS.length - 1 }),
    }),
  },
);

describe('ledger replay (T-QA-023)', () => {
  it('replaying the stored entries from empty equals the live state', async () => {
    await assertAsyncProp(
      fc.asyncProperty(
        fc.array(op, { minLength: 1, maxLength: 25 }),
        fc.boolean(),
        async (ops, hammer) => {
          const store = new InMemoryLedgerStore();
          const rt = new AuctionRuntime({ store, clock: { nowMs: () => FIXED_NOW } });
          let n = 100;
          let at = 0;
          const send = async (body: Record<string, unknown>, when: number): Promise<void> => {
            const cmd = {
              commandId: id((n += 1)),
              auctionId: AUCTION,
              at: when,
              ...body,
            } as unknown as Command;
            try {
              await rt.dispatch(cmd);
            } catch (e) {
              // A refused command appends nothing; any other failure is a real bug.
              if (!(e instanceof EngineError)) throw e;
            }
          };
          await send({ type: 'CreateAuction', title: 'Gala', config: {} }, 0);
          await send(
            {
              type: 'AddLot',
              lot: {
                lotId: LOT,
                title: 'Vase',
                mode: 'english',
                reserveCents: 1000,
                increment: { flatCents: 100 },
                durationMs: 10_000,
                softClose: { windowMs: 5000, extensionMs: 5000, maxExtensions: 3 },
                hammer: 'auto',
              },
            },
            0,
          );
          for (const b of BIDDERS) {
            await send({ type: 'RegisterBidder', bidderId: b, ceilingCents: 9000 }, 0);
          }
          at = 100;
          await send({ type: 'OpenLot', lotId: LOT }, at);
          for (const o of ops) {
            at += o.dt;
            if (o.kind === 'bid') {
              await send(
                {
                  type: 'PlaceBid',
                  lotId: LOT,
                  bidderId: BIDDERS[o.bidder],
                  amountCents: o.amount,
                  source: 'manual',
                  audit: {},
                },
                at,
              );
            } else if (o.kind === 'tick') {
              await send({ type: 'Tick' }, at);
            } else {
              await send(
                { type: 'RevokeCeiling', bidderId: BIDDERS[o.bidder], reason: 'declined' },
                at,
              );
            }
          }
          if (hammer) {
            await send({ type: 'Hammer', lotId: LOT, early: true, actor: 'host' }, at + 1);
          }
          const live = await rt.state(AUCTION);
          const entries = await store.read(AUCTION, 1);
          const head = await store.head(AUCTION);
          const rebuilt = replay(entries, undefined, head ?? undefined);
          expect(rebuilt).toEqual(live);
          expect(stateDigest(rebuilt)).toBe(stateDigest(live));
          // Sequence numbers are dense from 1: no gap, no duplicate.
          expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i + 1));
        },
      ),
    );
  });
});
