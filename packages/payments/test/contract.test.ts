import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApproveHoldRequest,
  ApproveHoldResponse,
  CreateHoldRequest,
  CreateHoldResponse,
  HOLD_ERROR_CODES,
  HoldErrorResponse,
  holdOwnedBySession,
} from '../src/contract/web.js';

const dir = join(import.meta.dirname, '..', 'src', 'contract', 'fixtures');
const load = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'));

describe('web contract fixtures (T-PAY-024)', () => {
  it('parse against their schemas', () => {
    expect(CreateHoldRequest.safeParse(load('create-hold.request.json')).success).toBe(true);
    expect(CreateHoldResponse.safeParse(load('create-hold.response.json')).success).toBe(true);
    expect(ApproveHoldRequest.safeParse(load('approve-hold.request.json')).success).toBe(true);
    expect(ApproveHoldResponse.safeParse(load('approve-hold.response.json')).success).toBe(true);
  });

  it('has one error fixture per error code and all parse', () => {
    for (const code of HOLD_ERROR_CODES) {
      const parsed = HoldErrorResponse.safeParse(load(`error-${code}.json`));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.error).toBe(code);
    }
  });

  it('every fixture file is covered', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(4 + HOLD_ERROR_CODES.length);
  });

  it('mutated examples fail', () => {
    const req = load('create-hold.request.json') as Record<string, unknown>;
    expect(CreateHoldRequest.safeParse({ ...req, ceilingCents: 150.5 }).success).toBe(false);
    expect(CreateHoldRequest.safeParse({ ...req, ceilingCents: 0 }).success).toBe(false);
    expect(CreateHoldRequest.safeParse({ ...req, extra: 1 }).success).toBe(false);
    expect(CreateHoldRequest.safeParse({ auctionId: req.auctionId }).success).toBe(false);
    const res = load('approve-hold.response.json') as Record<string, unknown>;
    expect(ApproveHoldResponse.safeParse({ ...res, status: 'CAPTURED' }).success).toBe(false);
    expect(ApproveHoldRequest.safeParse({}).success).toBe(false);
    expect(HoldErrorResponse.safeParse({ error: 'teapot' }).success).toBe(false);
  });

  it('rejects a browser-supplied bidderId on create', () => {
    const req = load('create-hold.request.json') as Record<string, unknown>;
    expect(req).not.toHaveProperty('bidderId');
    expect(CreateHoldRequest.safeParse({ ...req, bidderId: 'victim' }).success).toBe(false);
  });

  it('approve and abandon are allowed only for the hold owner', () => {
    expect(holdOwnedBySession('b1', 'b1')).toBe(true);
    expect(holdOwnedBySession('b1', 'b2')).toBe(false);
    expect(holdOwnedBySession('b1', undefined)).toBe(false);
    expect(holdOwnedBySession('', '')).toBe(false);
  });
});
