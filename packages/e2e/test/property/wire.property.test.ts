import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AUCTION_STATUSES,
  AuctionConfigSchema,
  BID_SOURCES,
  CROCKFORD,
  ERROR_CODES,
  MAX_FRAME_BYTES,
  MAX_SERVER_FRAME_BYTES,
  SETTLEMENT_STATES,
  decodeMsg,
  encodeMsg,
  isUlid,
} from '@gavel/shared';
import { propertyParams } from '../../src/property/harness';

// fc.assert with the shared reporter prints but does not throw, so run the check and throw.
function assertProp<T extends unknown[]>(prop: fc.IPropertyWithHooks<T>): void {
  const d = fc.check(prop, propertyParams());
  if (d.failed) {
    throw new Error(
      `property failed, replay with FC_SEED=${String(d.seed)}: ${JSON.stringify(d.counterexample)}`,
    );
  }
}

// T-QA-025: every wire message round trips, unknown fields are rejected and oversized
// frames are refused. The codec caps client frames at 16 KiB and server frames at 256 KiB
// and reports an oversized frame as bad_message ("frame too large"), not a FRAME_TOO_LARGE code.

const ulid = fc
  .tuple(
    fc.integer({ min: 0, max: 7 }),
    fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 25, maxLength: 25 }),
  )
  .map(([first, rest]) => CROCKFORD.charAt(first) + rest.map((i) => CROCKFORD.charAt(i)).join(''));

const cents = fc.integer({ min: 0, max: 99_999_999_999 });
const epoch = fc.integer({ min: 0, max: 4_000_000_000_000 });
const seq = fc.integer({ min: 1, max: 1_000_000 });
const paddle = fc.integer({ min: 1, max: 9999 });
const word = fc.stringMatching(/^[a-z][a-z0-9]{0,39}$/);
const token = fc.stringMatching(/^[a-z0-9]{1,30}$/);
const source = fc.constantFrom(...BID_SOURCES);
const errorCode = fc.constantFrom(...ERROR_CODES);
const ev = { seq, ts: epoch };

const config = AuctionConfigSchema.parse({
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: 1_789_000_000_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 10,
  ceilingPresets: [50000, 100000],
  confirmConfidenceThreshold: 0.85,
});

const publicAudit = fc.record({
  bidId: ulid,
  bidderId: ulid,
  source,
  parsedAmount: cents,
  outcome: fc.constant('accepted' as const),
  serverTs: epoch,
  seq,
});

const snapshot = fc.record({
  auctionId: ulid,
  config: fc.constant(config),
  status: fc.constantFrom(...AUCTION_STATUSES),
  price: fc.option(cents, { nil: null }),
  leaderId: fc.option(ulid, { nil: null }),
  endTs: epoch,
  minNext: cents,
  roster: fc.constant([]),
  recentAudit: fc.array(publicAudit, { maxLength: 3 }),
});

type Body = Record<string, unknown>;

const withType = (t: string, body: fc.Arbitrary<Body>): fc.Arbitrary<Body> =>
  body.map((b) => ({ v: 1, t, ...b }));

interface Case {
  readonly from: 'client' | 'server';
  readonly arb: fc.Arbitrary<Body>;
}

const messages: Record<string, Case> = {
  join: { from: 'client', arb: withType('join', fc.record({ token, auctionId: ulid })) },
  bid: { from: 'client', arb: withType('bid', fc.record({ mid: ulid, amount: cents, source })) },
  confirm_response: {
    from: 'client',
    arb: withType('confirm_response', fc.record({ confirmId: token, accept: fc.boolean() })),
  },
  registered: {
    from: 'server',
    arb: withType(
      'registered',
      fc.record({
        ...ev,
        bidderId: ulid,
        paddle,
        role: fc.constantFrom('auctioneer', 'bidder', 'screen'),
      }),
    ),
  },
  bid_accepted: {
    from: 'server',
    arb: withType('bid_accepted', fc.record({ ...ev, mid: ulid, bidId: ulid, amount: cents })),
  },
  bid_rejected: {
    from: 'server',
    arb: withType(
      'bid_rejected',
      fc.record({ ...ev, mid: ulid, reason: errorCode, retryable: fc.boolean() }),
    ),
  },
  price: {
    from: 'server',
    arb: withType(
      'price',
      fc.record({
        ...ev,
        price: cents,
        leaderId: fc.option(ulid, { nil: null }),
        leaderPaddle: fc.option(paddle, { nil: null }),
        endTs: epoch,
        minNext: cents,
        extensions: fc.nat(10),
      }),
    ),
  },
  state: { from: 'server', arb: withType('state', fc.record({ ...ev, snapshot })) },
  confirm_request: {
    from: 'server',
    arb: withType(
      'confirm_request',
      fc.record({ ...ev, confirmId: token, amount: cents, expiresAt: epoch }),
    ),
  },
  hammer: {
    from: 'server',
    arb: withType(
      'hammer',
      fc.record({
        ...ev,
        winnerId: fc.option(ulid, { nil: null }),
        price: cents,
        ranking: fc.array(fc.record({ bidderId: ulid, amount: cents }), { maxLength: 5 }),
      }),
    ),
  },
  settlement_update: {
    from: 'server',
    arb: withType(
      'settlement_update',
      fc.record({
        ...ev,
        rev: fc.nat(1000),
        auctionState: fc.constantFrom(...SETTLEMENT_STATES),
      }),
    ),
  },
  audit_event: {
    from: 'server',
    arb: withType('audit_event', fc.record({ ...ev, audit: publicAudit })),
  },
  error: { from: 'server', arb: withType('error', fc.record({ code: errorCode, message: word })) },
};

describe('wire messages (T-QA-025)', () => {
  it('covers all 13 message names', () => {
    expect(Object.keys(messages)).toHaveLength(13);
  });

  it('generates valid ids', () => {
    assertProp(fc.property(ulid, (id) => isUlid(id)));
  });

  for (const [name, { from, arb }] of Object.entries(messages)) {
    it(`${name}: encode then decode returns an equal value`, () => {
      assertProp(
        fc.property(arb, (msg) => {
          const enc = encodeMsg(msg);
          expect(enc.ok).toBe(true);
          if (!enc.ok) return;
          const dec = decodeMsg(enc.value, from);
          expect(dec.ok).toBe(true);
          if (!dec.ok) return;
          expect(dec.value).toEqual(msg);
        }),
      );
    });

    it(`${name}: an unknown field is rejected`, () => {
      assertProp(
        fc.property(arb, fc.stringMatching(/^zz[a-z]{1,8}$/), (msg, key) => {
          const extra = { ...msg, [key]: 1 };
          expect(decodeMsg(JSON.stringify(extra), from).ok).toBe(false);
          expect(encodeMsg(extra).ok).toBe(false);
        }),
      );
    });
  }

  it('rejects frames over the size cap in both directions', () => {
    assertProp(
      fc.property(fc.integer({ min: 1, max: 64 }), (extra) => {
        const client = decodeMsg(' '.repeat(MAX_FRAME_BYTES + extra), 'client');
        expect(client.ok).toBe(false);
        if (!client.ok) expect(client.error.message).toMatch(/too large/);
        const server = decodeMsg(' '.repeat(MAX_SERVER_FRAME_BYTES + extra), 'server');
        expect(server.ok).toBe(false);
        if (!server.ok) expect(server.error.message).toMatch(/too large/);
      }),
    );
  });
});
