import {
  AuditPayloadSchema,
  PublicAuditRowSchema,
  toPublicAudit,
  type ErrorCode,
  type PublicAuditRow,
  type RoomEvent,
} from '@gavel/shared';

/** `admin` is the operator key, not a token role. */
export type AuthRole = 'auctioneer' | 'bidder' | 'screen' | 'admin';

export const AUTH_ROLES: readonly AuthRole[] = ['auctioneer', 'bidder', 'screen', 'admin'];

export const OPERATIONS = [
  'ws_join',
  'bid_own',
  'bid_manual_for_others',
  'confirm_response',
  'control',
  'invites_rotate',
  'snapshot',
  'export',
  'create_demo_ops',
] as const;
export type Operation = (typeof OPERATIONS)[number];

/** The single role-by-operation table (R-RT-085). Anything not listed is denied. */
export const AUTH_MATRIX: Readonly<Record<Operation, readonly AuthRole[]>> = {
  ws_join: ['auctioneer', 'bidder', 'screen'],
  bid_own: ['bidder'],
  bid_manual_for_others: ['auctioneer'],
  confirm_response: ['bidder'],
  control: ['auctioneer'],
  invites_rotate: ['auctioneer'],
  snapshot: ['auctioneer', 'bidder', 'screen'],
  export: ['auctioneer', 'admin'],
  create_demo_ops: ['admin'],
};

export type AuthDecision = { ok: true } | { ok: false; code: Extract<ErrorCode, 'forbidden'> };

export function authorize(op: Operation, role: AuthRole): AuthDecision {
  const allowed =
    Object.prototype.hasOwnProperty.call(AUTH_MATRIX, op) && AUTH_MATRIX[op].includes(role);
  return allowed ? { ok: true } : { ok: false, code: 'forbidden' };
}

/** Matches `ceiling` and the web wire name `ceilingCents`, not the public `ceilingPresets`. */
const CEILING_KEY = /^ceiling(cents)?$/i;

/**
 * Remove private fields from an outbound frame for one viewer (R-RT-055, R-RT-086).
 *
 * - Auctioneer, screen and admin never receive a `ceiling` (auctioneers see hold
 *   state), and screens never receive `you`.
 * - A bidder keeps `you`, `yourHold` and `ceiling` only where the object names
 *   the viewer's own bidderId; anything else is dropped (fail closed).
 * - Everyone but the auctioneer and admin sees public audit rows only: accepted
 *   bids, no transcripts, no reject reasons (R-RT-038).
 *
 * Returns null when the whole frame must not be sent to this viewer (an
 * `audit_event` for a row that is not public).
 */
export function redactForViewer<T>(
  role: AuthRole,
  viewerBidderId: string | undefined,
  frame: T,
): T | null {
  const fullAudit = role === 'auctioneer' || role === 'admin';
  if (!fullAudit && isAuditEventFrame(frame)) {
    if (toPublicRow(frame.audit) === null) return null;
  }
  return walk(role, viewerBidderId, frame, undefined, fullAudit) as T;
}

function isAuditEventFrame(frame: unknown): frame is { t: 'audit_event'; audit: unknown } {
  return (
    typeof frame === 'object' &&
    frame !== null &&
    (frame as { t?: unknown }).t === 'audit_event' &&
    'audit' in frame
  );
}

function toPublicRow(row: unknown): PublicAuditRow | null {
  const parsed = AuditPayloadSchema.safeParse(row);
  if (parsed.success) return toPublicAudit(parsed.data);
  const pub = PublicAuditRowSchema.safeParse(row);
  return pub.success ? pub.data : null;
}

function walk(
  role: AuthRole,
  viewer: string | undefined,
  value: unknown,
  parentKey: string | undefined,
  fullAudit: boolean,
): unknown {
  if (Array.isArray(value)) {
    if (!fullAudit && parentKey === 'recentAudit') {
      return value.map(toPublicRow).filter((r): r is PublicAuditRow => r !== null);
    }
    if (role === 'auctioneer' && parentKey === 'recentAudit') return value.map(scrubCeilingRow);
    return value.map((v) => walk(role, viewer, v, parentKey, fullAudit));
  }
  if (typeof value !== 'object' || value === null) return value;

  if (!fullAudit && parentKey === 'audit') {
    return toPublicRow(value) ?? {};
  }
  if (role === 'auctioneer' && parentKey === 'audit') return scrubCeilingRow(value);
  const obj = value as Record<string, unknown>;
  const owner = typeof obj.bidderId === 'string' ? obj.bidderId : undefined;
  const mine = role === 'bidder' && viewer !== undefined && owner === viewer;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // `you` is the viewer's own block or, on a settlement frame, their own settlement state;
    // the room builds both per connection, so a bidder only ever holds their own.
    if (k === 'you' && !(role === 'bidder' && (typeof v === 'string' || isOwn(v, viewer))))
      continue;
    // `yourHold` names its bidder: only that bidder may receive it (fail closed).
    if (k === 'yourHold' && !(role === 'bidder' && isOwn(v, viewer))) continue;
    if (CEILING_KEY.test(k) && !mine) continue;
    out[k] = walk(role, viewer, v, k, fullAudit);
  }
  return out;
}

/**
 * The auctioneer holds state only (R-RT-055): an over_ceiling row loses the amount and the
 * spoken words, because either one is a lower bound on the bidder's private ceiling.
 */
function scrubCeilingRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null) return row;
  const obj = row as Record<string, unknown>;
  if (obj.reason !== 'over_ceiling') return row;
  const out = { ...obj };
  delete out.parsedAmount;
  delete out.transcript;
  delete out.audioTsMs;
  delete out.audioEndMs;
  // The auctioneer picked the amount of a manual bid: the reason would be a ceiling probe.
  if (obj.source === 'manual') out.reason = 'limit_exceeded';
  return out;
}

function isOwn(you: unknown, viewer: string | undefined): boolean {
  return (
    viewer !== undefined &&
    typeof you === 'object' &&
    you !== null &&
    (you as { bidderId?: unknown }).bidderId === viewer
  );
}

/** A persisted event as exported: the bidder's ceiling is never included. */
export type ExportedEvent =
  | Exclude<RoomEvent, { type: 'bidder_registered' | 'ceiling_raised' }>
  | Omit<Extract<RoomEvent, { type: 'bidder_registered' }>, 'ceiling'>
  | Omit<Extract<RoomEvent, { type: 'ceiling_raised' }>, 'ceiling' | 'from'>;

/**
 * Event log export for a role (R-RT-108). The auctioneer export drops ceilings
 * and the amounts of ceiling rejections; only the operator key gets the raw log.
 */
export function redactEventForExport(role: AuthRole, event: RoomEvent): ExportedEvent {
  if (role === 'admin') return event;
  if (event.type === 'bidder_registered') {
    const copy: Partial<typeof event> = { ...event };
    delete copy.ceiling;
    return copy as Omit<typeof event, 'ceiling'>;
  }
  if (event.type === 'ceiling_raised') {
    const copy: Partial<typeof event> = { ...event };
    delete copy.ceiling;
    delete copy.from;
    return copy as Omit<typeof event, 'ceiling' | 'from'>;
  }
  if (event.type === 'bid_rejected' && event.reason === 'over_ceiling') {
    const copy: Partial<typeof event> = { ...event };
    delete copy.amount;
    const audit: Partial<typeof event.audit> = { ...event.audit };
    delete audit.parsedAmount;
    delete audit.transcript;
    delete audit.audioTsMs;
    delete audit.audioEndMs;
    if (event.audit.source === 'manual') {
      copy.reason = 'limit_exceeded';
      audit.reason = 'limit_exceeded';
    }
    return { ...copy, audit } as typeof event;
  }
  if (event.type === 'confirm_requested') {
    const copy: Partial<typeof event> = { ...event };
    delete copy.amount;
    const audit: Partial<typeof event.audit> = { ...event.audit };
    delete audit.parsedAmount;
    delete audit.transcript;
    delete audit.audioTsMs;
    delete audit.audioEndMs;
    return { ...copy, audit } as unknown as ExportedEvent;
  }
  if (event.type === 'confirm_resolved') {
    const audit: Partial<typeof event.audit> = { ...event.audit };
    delete audit.parsedAmount;
    delete audit.transcript;
    delete audit.audioTsMs;
    delete audit.audioEndMs;
    return { ...event, audit } as typeof event;
  }
  if (event.type === 'voice_dropped') {
    // Who was named and which amount was heard stay with the operator key.
    const drop: Partial<typeof event.drop> = { ...event.drop };
    delete drop.bidderId;
    delete drop.parsedCents;
    return { ...event, drop } as typeof event;
  }
  return event;
}
