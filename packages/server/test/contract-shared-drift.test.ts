import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HoldError, toHoldError, PayPalError, type HoldStatus } from '@gavel/payments';
import type * as local from '@gavel/payments/contract/web';
import * as shared from '@gavel/shared';
import { describe, expect, it } from 'vitest';

const dir = new URL('../../payments/src/contract/fixtures/', import.meta.url).pathname;
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown] as const);

/** True only when the two types are the same type. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Compile-time: the payments contract names the shared types, so they cannot drift (issue 896).
const sameTypes: readonly true[] = [
  true satisfies Same<local.HoldErrorCode, shared.HoldErrorCode>,
  true satisfies Same<local.CreateHoldRequest, shared.CreateHoldRequest>,
  true satisfies Same<local.CreateHoldResponse, shared.CreateHoldResponse>,
  true satisfies Same<local.ApproveHoldRequest, shared.ApproveHoldRequest>,
  true satisfies Same<local.ApproveHoldResponse, shared.ApproveHoldResponse>,
  true satisfies Same<local.HoldErrorResponse, shared.HoldErrorResponse>,
  true satisfies Same<local.HoldViewResponse, shared.HoldViewResponse>,
  true satisfies Same<local.AbandonHoldResponse, shared.AbandonHoldResponse>,
  true satisfies Same<HoldStatus, shared.HoldStatusName>,
  true satisfies Same<HoldError['code'], shared.HoldErrorCode>,
];

/**
 * One hold contract (R-PAY-030, R-PAY-035, issue 896): web, server and payments all take it from
 * @gavel/shared. The payments module only re-exports its types, so it holds no copy that could
 * accept a body the shared schema refuses.
 */
describe('hold contract: one copy in @gavel/shared', () => {
  it('the payments contract module carries no schemas of its own', async () => {
    const mod = (await import('@gavel/payments/contract/web')) as Record<string, unknown>;
    for (const name of [
      'CreateHoldRequest',
      'CreateHoldResponse',
      'ApproveHoldRequest',
      'ApproveHoldResponse',
      'HoldErrorResponse',
      'HOLD_ERROR_CODES',
      'HOLD_ERROR_STATUS',
      'holdOwnedBySession',
    ]) {
      expect(mod[name], name).toBeUndefined();
    }
    expect(sameTypes.every(Boolean)).toBe(true);
  });

  it('accepts every payments fixture in a shared schema', () => {
    const schemas = [
      shared.CreateHoldRequest,
      shared.CreateHoldResponse,
      shared.ApproveHoldRequest,
      shared.ApproveHoldResponse,
      shared.HoldErrorResponse,
    ];
    for (const [file, body] of fixtures) {
      expect(
        schemas.some((s) => s.safeParse(body).success),
        file,
      ).toBe(true);
    }
  });

  it('maps every payments failure to a shared error code with a shared status', () => {
    const failure = (kind: PayPalError['kind'], status: number): PayPalError =>
      new PayPalError({ kind, status, name: kind, message: kind, outcome: 'definite' });
    const failures = [
      failure('kill_switch_engaged', 0),
      failure('ceiling_out_of_range', 0),
      failure('not_found', 404),
      failure('server_error', 500),
    ];
    for (const e of failures) {
      const code = toHoldError(e).code;
      expect(shared.HOLD_ERROR_CODES).toContain(code);
      expect(shared.HOLD_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
});
