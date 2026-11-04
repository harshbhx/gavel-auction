import {
  AUCTION_MODES,
  AUDIT_KINDS,
  MESSAGE_NAMES,
  ROOM_STATUSES,
  SETTLEMENT_STATES,
  type MessageName,
  type ServerMessage,
} from './contract';

type Rec = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str: Check = (v) => typeof v === 'string';
const nonEmpty: Check = (v) => typeof v === 'string' && v.length > 0;
const int: Check = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const bool: Check = (v) => typeof v === 'boolean';
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v);
const nullable =
  (c: Check): Check =>
  (v) =>
    v === null || c(v);
const arrayOf =
  (c: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(c);

/** Field table: required fields must pass, optional fields must pass when present. */
const shape =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v) => {
    if (!isRec(v)) return false;
    for (const [k, c] of Object.entries(required)) if (!c(v[k])) return false;
    for (const [k, c] of Object.entries(optional)) if (k in v && !c(v[k])) return false;
    return true;
  };

const settlementState = oneOf(SETTLEMENT_STATES);

const hold = shape(
  {
    paddle: int,
    name: str,
    ceilingCents: int,
    state: settlementState,
    capturedCents: int,
    releasedCents: int,
    verifiedBy: arrayOf(
      shape({ eventId: str, kind: oneOf(['webhook', 'lookup']), at: num }, { eventType: str }),
    ),
    idSuffix: (v) => typeof v === 'string' && v.length <= 6,
  },
  { reason: str },
);

const settlement = shape({
  lotId: str,
  phase: settlementState,
  winnerPaddle: nullable(int),
  holds: arrayOf(hold),
  invariants: shape({ ok: bool, violations: arrayOf(str) }),
});

const roomConfig = shape({
  minIncrementCents: int,
  reserveCents: int,
  softCloseMs: int,
  maxCeilingCents: int,
  minCeilingCents: int,
  lateEntry: bool,
  mode: oneOf(AUCTION_MODES),
});

const room = shape({ id: str, name: str, status: oneOf(ROOM_STATUSES), config: roomConfig });

const lot = nullable(shape({ id: str, title: str }, { imageUrl: str, closesAt: num }));

const price = shape({
  currentCents: nullable(int),
  leaderPaddle: nullable(int),
  nextMinCents: int,
  bidCount: int,
});

const bidder = shape(
  { paddle: int, name: str, holdState: oneOf([...SETTLEMENT_STATES, 'NONE']) },
  { ceilingCents: int },
);

const you = shape({ bidderId: str, paddle: int, ceilingCents: int, holdState: settlementState });

/** Per-message body checks. Typed as a full record so a new MessageName fails to compile here. */
const bodies: Record<MessageName, Check> = {
  join: shape({}),
  registered: shape({ bidderId: nonEmpty, paddle: int, name: str, ceilingCents: int }),
  bid: shape({ paddle: int, amountCents: int }, { clientBidId: str }),
  bid_accepted: shape({ clientBidId: nonEmpty, paddle: int, amountCents: int }),
  bid_rejected: shape({ clientBidId: nonEmpty, code: nonEmpty, message: str }, { details: isRec }),
  price: shape(
    { currentCents: nullable(int), leaderPaddle: nullable(int), nextMinCents: int, bidCount: int },
    { closesAt: num },
  ),
  state: shape({ room, lot, price, bidders: arrayOf(bidder) }, { you, settlement }),
  confirm_request: shape(
    {
      confirmId: nonEmpty,
      paddle: int,
      amountCents: int,
      expiresAt: num,
      addressee: oneOf(['bidder', 'auctioneer', 'both']),
    },
    { transcript: str, confidence: num },
  ),
  confirm_response: shape({ confirmId: nonEmpty, accept: bool }),
  hammer: shape({
    lotId: str,
    winnerPaddle: nullable(int),
    priceCents: nullable(int),
    reserveMet: bool,
  }),
  settlement_update: shape({ settlement }),
  audit_event: shape(
    { id: nonEmpty, kind: oneOf(AUDIT_KINDS), at: num, raw: () => true },
    {
      audioOffsetMs: num,
      paddle: int,
      transcript: str,
      parsedCents: int,
      confidence: num,
      confirmed: oneOf(['yes', 'no', 'auto']),
      result: oneOf(['accepted', 'rejected']),
      reason: str,
    },
  ),
  error: shape({ code: nonEmpty, message: str }),
};

/** Every message name this module validates. The drift test compares it with the shared union. */
export const handledMessageNames: readonly MessageName[] = MESSAGE_NAMES.filter((n) => n in bodies);

function isMessageName(v: unknown): v is MessageName {
  return typeof v === 'string' && (MESSAGE_NAMES as readonly string[]).includes(v);
}

/** True only for a well-formed server message: envelope fields plus a valid body. */
export function isServerMessage(raw: unknown): raw is ServerMessage {
  if (!isRec(raw)) return false;
  const name = raw['t'];
  if (!isMessageName(name)) return false;
  if (!int(raw['seq']) || !nonEmpty(raw['roomId']) || !int(raw['serverTime'])) return false;
  return bodies[name](raw);
}

/** Validate before reducing: returns the message, or null for anything malformed. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  return isServerMessage(raw) ? raw : null;
}
