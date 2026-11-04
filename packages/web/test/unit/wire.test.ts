import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  MESSAGE_NAMES,
  handledMessageNames,
  isServerMessage,
  parseServerMessage,
  type MessageName,
  type ServerMessage,
  type SettlementView,
} from '../../src/wire';

const env = { seq: 7, roomId: 'room-1', serverTime: 1_700_000_000_000 } as const;

const settlement: SettlementView = {
  lotId: 'lot-1',
  phase: 'CAPTURED',
  winnerPaddle: 12,
  holds: [
    {
      paddle: 12,
      name: 'Ada',
      ceilingCents: 50_000,
      state: 'CAPTURED',
      capturedCents: 35_000,
      releasedCents: 15_000,
      verifiedBy: [
        { eventId: 'ev-1', kind: 'webhook', eventType: 'PAYMENT.CAPTURE.COMPLETED', at: 5 },
      ],
      idSuffix: 'a1b2c3',
    },
  ],
  invariants: { ok: true, violations: [] },
};

const fixtures: Record<MessageName, ServerMessage> = {
  join: { t: 'join', ...env },
  registered: {
    t: 'registered',
    ...env,
    bidderId: 'b-1',
    paddle: 12,
    name: 'Ada',
    ceilingCents: 50_000,
  },
  bid: { t: 'bid', ...env, paddle: 12, amountCents: 35_000, clientBidId: 'c-1' },
  bid_accepted: { t: 'bid_accepted', ...env, clientBidId: 'c-1', paddle: 12, amountCents: 35_000 },
  bid_rejected: {
    t: 'bid_rejected',
    ...env,
    clientBidId: 'c-1',
    code: 'over_ceiling',
    message: 'no',
    details: { max: 1 },
  },
  price: {
    t: 'price',
    ...env,
    currentCents: 35_000,
    leaderPaddle: 12,
    nextMinCents: 36_000,
    bidCount: 3,
  },
  state: {
    t: 'state',
    ...env,
    room: {
      id: 'room-1',
      name: 'Demo',
      status: 'OPEN',
      config: {
        minIncrementCents: 1_000,
        reserveCents: 10_000,
        softCloseMs: 10_000,
        maxCeilingCents: 100_000,
        minCeilingCents: 5_000,
        lateEntry: true,
        mode: 'english',
      },
    },
    lot: { id: 'lot-1', title: 'Clock', closesAt: 99 },
    price: { currentCents: null, leaderPaddle: null, nextMinCents: 10_000, bidCount: 0 },
    bidders: [{ paddle: 12, name: 'Ada', holdState: 'HELD', ceilingCents: 50_000 }],
    you: { bidderId: 'b-1', paddle: 12, ceilingCents: 50_000, holdState: 'HELD' },
    settlement,
  },
  confirm_request: {
    t: 'confirm_request',
    ...env,
    confirmId: 'cf-1',
    paddle: 12,
    amountCents: 35_000,
    transcript: 'three fifty',
    confidence: 0.8,
    expiresAt: 1_700_000_005_000,
    addressee: 'both',
  },
  confirm_response: { t: 'confirm_response', ...env, confirmId: 'cf-1', accept: true },
  hammer: {
    t: 'hammer',
    ...env,
    lotId: 'lot-1',
    winnerPaddle: 12,
    priceCents: 35_000,
    reserveMet: true,
  },
  settlement_update: { t: 'settlement_update', ...env, settlement },
  audit_event: {
    t: 'audit_event',
    ...env,
    id: 'au-1',
    kind: 'bid',
    at: 3,
    paddle: 12,
    result: 'accepted',
    raw: { x: 1 },
  },
  error: { t: 'error', ...env, code: 'bad_message', message: 'bad' },
};

describe('wire seam and drift (T-WEB-002)', () => {
  it('handles exactly the MessageName union', () => {
    expect([...handledMessageNames].sort()).toEqual([...MESSAGE_NAMES].sort());
    expectTypeOf<ServerMessage['t']>().toEqualTypeOf<MessageName>();
    expect(Object.keys(fixtures).sort()).toEqual([...MESSAGE_NAMES].sort());
  });

  it.each(MESSAGE_NAMES)('accepts the %s fixture', (name) => {
    const fixture = fixtures[name];
    expect(isServerMessage(fixture)).toBe(true);
    expect(parseServerMessage(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
  });
});

type Mutation = readonly [label: string, make: () => unknown];

function without(name: MessageName, key: string): unknown {
  const copy: Record<string, unknown> = { ...fixtures[name] };
  delete copy[key];
  return copy;
}

function withField(name: MessageName, key: string, value: unknown): unknown {
  return { ...fixtures[name], [key]: value };
}

const mutations: readonly Mutation[] = [
  ['null', () => null],
  ['string', () => 'price'],
  ['array', () => []],
  ['empty object', () => ({})],
  ['unknown name', () => withField('price', 't', 'nope')],
  ['numeric name', () => withField('price', 't', 5)],
  ['missing seq', () => without('price', 'seq')],
  ['string seq', () => withField('price', 'seq', '7')],
  ['negative seq', () => withField('price', 'seq', -1)],
  ['fractional seq', () => withField('price', 'seq', 1.5)],
  ['missing roomId', () => without('price', 'roomId')],
  ['missing serverTime', () => without('hammer', 'serverTime')],
  ['fractional cents', () => withField('bid_accepted', 'amountCents', 10.5)],
  ['string cents', () => withField('price', 'currentCents', '350')],
  [
    'bad room status',
    () => ({
      ...fixtures.state,
      room: { ...(fixtures.state as { room: object }).room, status: 'FROZEN' },
    }),
  ],
  [
    'bad hold state',
    () => withField('settlement_update', 'settlement', { ...settlement, phase: 'PAID' }),
  ],
  ['bad addressee', () => withField('confirm_request', 'addressee', 'everyone')],
  ['accept not boolean', () => withField('confirm_response', 'accept', 'yes')],
  ['bad audit kind', () => withField('audit_event', 'kind', 'whisper')],
  ['missing code on error', () => without('error', 'code')],
];

describe('guard rejects malformed input', () => {
  it('has at least 20 mutation cases', () => {
    expect(mutations.length).toBeGreaterThanOrEqual(20);
  });

  it.each(mutations)('rejects: %s', (_label, make) => {
    const candidate = make();
    expect(isServerMessage(candidate)).toBe(false);
    expect(parseServerMessage(candidate)).toBeNull();
  });
});
