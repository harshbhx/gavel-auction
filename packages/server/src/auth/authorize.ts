import type { ErrorCode } from '@gavel/shared';

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

/**
 * Remove bidder-private fields (ceilings) from an outbound frame for roles that
 * must not see them (R-RT-086). Screens never receive `ceiling` or `you`.
 */
export function redactForRole<T>(role: AuthRole, frame: T): T {
  if (role !== 'screen') return frame;
  return stripKeys(frame, new Set(['ceiling', 'you'])) as T;
}

function stripKeys(value: unknown, drop: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => stripKeys(v, drop));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!drop.has(k)) out[k] = stripKeys(v, drop);
    }
    return out;
  }
  return value;
}
