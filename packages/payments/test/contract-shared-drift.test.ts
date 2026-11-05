import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as shared from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import * as local from '../src/contract/web.js';

const dir = new URL('../src/contract/fixtures/', import.meta.url).pathname;
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown] as const);

/**
 * The web client imports the hold contract from @gavel/shared, the server from here. The two
 * copies must agree on codes, statuses and on what each schema accepts (R-PAY-030, R-PAY-035).
 */
describe('hold contract: payments copy against @gavel/shared', () => {
  it('lists the same error codes and statuses', () => {
    expect([...local.HOLD_ERROR_CODES]).toEqual([...shared.HOLD_ERROR_CODES]);
    expect(local.HOLD_ERROR_STATUS).toEqual(shared.HOLD_ERROR_STATUS);
  });

  it('uses the same abandon method', () => {
    expect(local.ABANDON_HOLD_METHOD).toBe(shared.ABANDON_HOLD_METHOD);
  });

  const pairs = [
    ['CreateHoldRequest', local.CreateHoldRequest, shared.CreateHoldRequest],
    ['CreateHoldResponse', local.CreateHoldResponse, shared.CreateHoldResponse],
    ['ApproveHoldRequest', local.ApproveHoldRequest, shared.ApproveHoldRequest],
    ['ApproveHoldResponse', local.ApproveHoldResponse, shared.ApproveHoldResponse],
    ['HoldErrorResponse', local.HoldErrorResponse, shared.HoldErrorResponse],
  ] as const;

  it.each(pairs)('%s accepts and rejects the same bodies', (_name, a, b) => {
    const bodies: unknown[] = [
      ...fixtures.map(([, body]) => body),
      {},
      { auctionId: 'a', ceilingCents: 100, bidderId: 'b' },
      { auctionId: 'a', ceilingCents: 100, approveUrl: 'https://example.test/approve' },
    ];
    for (const body of bodies) {
      expect(a.safeParse(body).success).toBe(b.safeParse(body).success);
    }
  });

  it('accepts every payments fixture in at least one shared schema', () => {
    for (const [file, body] of fixtures) {
      const ok = pairs.some(([, , s]) => s.safeParse(body).success);
      expect(ok, file).toBe(true);
    }
  });
});
