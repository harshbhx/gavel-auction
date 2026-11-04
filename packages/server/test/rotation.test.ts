import { describe, expect, it } from 'vitest';
import { secretSetFromConfig, signWithCurrent, verifyRotating } from '../src/auth/rotation';
import {
  signToken,
  TOKEN_TTL_S,
  verifyToken,
  type JtiStore,
  type TokenPayload,
} from '../src/auth/token';

const AUCTION = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
const BIDDER = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const OLD = 'fake-old-secret-fake-old-secret-00';
const NEW = 'fake-new-secret-fake-new-secret-00';
const NOW_S = 1_789_000_000;

const payload: TokenPayload = {
  kind: 'session',
  aud: AUCTION,
  sub: BIDDER,
  bidderId: BIDDER,
  jti: '01J9ZQ6A0B2C4D6F8H0J2K4M6N',
  iat: NOW_S,
  exp: NOW_S + TOKEN_TTL_S.session,
};

const jtis: JtiStore = {
  isRevoked: () => Promise.resolve(false),
  consume: () => Promise.resolve(true),
};

const opts = { aud: AUCTION, kinds: ['session'] as const, nowMs: NOW_S * 1000, jtis };

describe('secret rotation (T-RT-060)', () => {
  const rotating = secretSetFromConfig({ TOKEN_SECRET: NEW, TOKEN_SECRET_PREVIOUS: OLD });

  it('verifies a token signed with the previous secret', async () => {
    const token = await signToken(payload, OLD);
    expect((await verifyRotating(token, rotating, opts)).ok).toBe(true);
  });

  it('verifies a token signed with the current secret', async () => {
    const token = await signWithCurrent(payload, rotating);
    expect((await verifyRotating(token, rotating, opts)).ok).toBe(true);
  });

  it('signs with the current secret only', async () => {
    const token = await signWithCurrent(payload, rotating);
    expect((await verifyToken(token, NEW, opts)).ok).toBe(true);
    expect((await verifyToken(token, OLD, opts)).ok).toBe(false);
  });

  it('rejects the previous secret once it is removed', async () => {
    const token = await signToken(payload, OLD);
    const after = secretSetFromConfig({ TOKEN_SECRET: NEW });
    expect((await verifyRotating(token, after, opts)).ok).toBe(false);
  });

  it('rejects a token signed with an unrelated secret', async () => {
    const token = await signToken(payload, 'fake-other-secret-fake-other-secret');
    expect((await verifyRotating(token, rotating, opts)).ok).toBe(false);
  });

  it('lists current first and drops a duplicate previous', () => {
    expect(rotating.verifying).toEqual([NEW, OLD]);
    expect(
      secretSetFromConfig({ TOKEN_SECRET: NEW, TOKEN_SECRET_PREVIOUS: NEW }).verifying,
    ).toEqual([NEW]);
  });
});

describe('previous secret end time (R4-W09)', () => {
  const until = (NOW_S + 3600) * 1000;
  const set = secretSetFromConfig({
    TOKEN_SECRET: NEW,
    TOKEN_SECRET_PREVIOUS: OLD,
    TOKEN_SECRET_PREVIOUS_UNTIL: until,
  });

  it('accepts the previous secret before its end time and counts the use', async () => {
    let hits = 0;
    const counted = { ...set, onPreviousUse: () => void (hits += 1) };
    const token = await signToken(payload, OLD);
    expect((await verifyRotating(token, counted, opts)).ok).toBe(true);
    expect(hits).toBe(1);
    const fresh = await signWithCurrent(payload, counted);
    expect((await verifyRotating(fresh, counted, opts)).ok).toBe(true);
    expect(hits).toBe(1);
  });

  it('refuses the previous secret once its end time has passed', async () => {
    const token = await signToken(payload, OLD);
    const late = { ...opts, nowMs: until };
    expect((await verifyRotating(token, set, late)).ok).toBe(false);
    const current = await signWithCurrent(payload, set);
    expect((await verifyRotating(current, set, late)).ok).toBe(true);
  });
});
