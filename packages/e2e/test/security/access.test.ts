import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_MATRIX, authorize, type Operation } from '@gavel/server/src/auth/authorize';
import {
  MAX_IAT_SKEW_S,
  TOKEN_TTL_S,
  signToken,
  verifyToken,
  type JtiStore,
  type TokenPayload,
} from '@gavel/server/src/auth/token';
import type { EpochMs } from '@gavel/shared';
import { CONFIG, bidMessage, connect, enroll, makeRig, type Rig } from '../flow/rig';

// T-QA-070, T-QA-071, T-QA-079 (R-QA-036): a bidder cannot hammer or bid for someone else, a token
// is bound to one bidder and one auction, and a client clock never decides ordering.

const SECRET = 'placeholder-signing-secret-for-tests';
const OTHER_SECRET = 'placeholder-other-secret-for-tests';

const open: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

async function newRig(): Promise<Rig> {
  const rig = await makeRig();
  open.push(rig.paypal);
  return rig;
}

class MemoryJtis implements JtiStore {
  readonly revoked = new Set<string>();
  private readonly used = new Set<string>();
  isRevoked(jti: string): Promise<boolean> {
    return Promise.resolve(this.revoked.has(jti));
  }
  consume(jti: string): Promise<boolean> {
    if (this.used.has(jti)) return Promise.resolve(false);
    this.used.add(jti);
    return Promise.resolve(true);
  }
}

describe('role matrix over the room (T-QA-070)', () => {
  it('answers forbidden when a bidder sends a hammer and the auction stays open', async () => {
    const rig = await newRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
    const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
    await room.submitBid(ana.conn, bidMessage(rig, 10000, 'manual'));
    const before = await rig.stores.store.lastSeq(auctionId);

    await room.control(ana.conn, { controlId: 'h-1', action: 'hammer', args: { closeNow: 1 } });

    expect(ana.transport.messages('error').at(-1)).toMatchObject({ code: 'forbidden' });
    expect(await rig.stores.store.lastSeq(auctionId)).toBe(before);
    const events = await rig.stores.store.readEvents(auctionId, 1, 1000);
    expect(events.some((e) => e.type === 'hammered')).toBe(false);
    await service.close();
  });

  it('answers forbidden to a screen that bids and appends nothing', async () => {
    const rig = await newRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
    await enroll(rig, service, room, auctionId, 'Ana', 50000);
    const screen = await connect(rig, room, 'screen');
    const before = await rig.stores.store.lastSeq(auctionId);

    await room.submitBid(screen.conn, bidMessage(rig, 10000, 'manual'));

    expect(screen.transport.messages('error').at(-1)).toMatchObject({ code: 'forbidden' });
    expect(await rig.stores.store.lastSeq(auctionId)).toBe(before);
    await service.close();
  });

  it('records a bid under the token identity even when the frame names another bidder', async () => {
    const rig = await newRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
    const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
    const ben = await enroll(rig, service, room, auctionId, 'Ben', 50000);

    await room.submitBid(ana.conn, { ...bidMessage(rig, 10000, 'manual'), bidderId: ben.id });

    const events = await rig.stores.store.readEvents(auctionId, 1, 1000);
    const accepted = events.filter((e) => e.type === 'bid_accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ bidderId: ana.id });
    await service.close();
  });

  it('denies every operation to a role the matrix does not list, and unknown operations', () => {
    const roles = ['auctioneer', 'bidder', 'screen', 'admin'] as const;
    for (const [op, allowed] of Object.entries(AUTH_MATRIX)) {
      for (const role of roles) {
        const decision = authorize(op as Operation, role);
        expect(decision.ok).toBe(allowed.includes(role));
        if (!decision.ok) expect(decision.code).toBe('forbidden');
      }
    }
    expect(authorize('__proto__' as Operation, 'admin')).toEqual({ ok: false, code: 'forbidden' });
    expect(authorize('toString' as Operation, 'auctioneer')).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });
});

describe('token binding (T-QA-071)', () => {
  const NOW = 1_789_000_000_000;
  const nowSec = Math.floor(NOW / 1000);

  async function session(
    rig: Rig,
    aud: string,
    overrides: Partial<TokenPayload> = {},
  ): Promise<{ token: string; payload: TokenPayload }> {
    const bidderId = rig.ids.mint<'BidderId'>();
    const payload: TokenPayload = {
      kind: 'session',
      aud,
      sub: bidderId,
      bidderId,
      jti: rig.ids.mint<'MsgId'>(),
      iat: nowSec,
      exp: nowSec + 600,
      ...overrides,
    };
    return { token: await signToken(payload, SECRET), payload };
  }

  const opts = (aud: string, jtis: JtiStore, nowMs: number = NOW) => ({
    aud,
    kinds: ['session'] as const,
    nowMs,
    jtis,
  });

  it('accepts a token for its own auction and bidder', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const { token, payload } = await session(rig, aud);
    const res = await verifyToken(token, SECRET, opts(aud, new MemoryJtis()));
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.payload.bidderId).toBe(payload.bidderId);
  });

  it('refuses a token presented to another auction', async () => {
    const rig = await newRig();
    const { token } = await session(rig, rig.ids.mint<'AuctionId'>());
    const res = await verifyToken(
      token,
      SECRET,
      opts(rig.ids.mint<'AuctionId'>(), new MemoryJtis()),
    );
    expect(res).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('refuses a token whose subject is not its bidder', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const { token } = await session(rig, aud, { sub: rig.ids.mint<'BidderId'>() });
    const res = await verifyToken(token, SECRET, opts(aud, new MemoryJtis()));
    expect(res).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('refuses a session token without a bidder id and a token of the wrong kind', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const noBidder = await signToken(
      {
        kind: 'session',
        aud,
        sub: 'someone',
        jti: rig.ids.mint<'MsgId'>(),
        iat: nowSec,
        exp: nowSec + 600,
      },
      SECRET,
    );
    expect(await verifyToken(noBidder, SECRET, opts(aud, new MemoryJtis()))).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    const screen = await signToken(
      {
        kind: 'screen',
        aud,
        sub: 'wall',
        jti: rig.ids.mint<'MsgId'>(),
        iat: nowSec,
        exp: nowSec + 600,
      },
      SECRET,
    );
    expect(await verifyToken(screen, SECRET, opts(aud, new MemoryJtis()))).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
  });

  it('refuses a forged signature, a tampered payload and a truncated token', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const { token } = await session(rig, aud);
    const jtis = new MemoryJtis();
    const forged = await signToken((await session(rig, aud)).payload, OTHER_SECRET);
    expect(await verifyToken(forged, SECRET, opts(aud, jtis))).toMatchObject({ ok: false });

    const [body = '', sig = ''] = token.split('.');
    const other = (await session(rig, aud)).token.split('.')[0] ?? '';
    expect(await verifyToken(`${other}.${sig}`, SECRET, opts(aud, jtis))).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    expect(await verifyToken(body, SECRET, opts(aud, jtis))).toMatchObject({ ok: false });
    expect(await verifyToken('', SECRET, opts(aud, jtis))).toMatchObject({ ok: false });
    expect(await verifyToken(`${token}.x`, SECRET, opts(aud, jtis))).toMatchObject({ ok: false });
  });

  it('refuses an expired token, a token from the future and a lifetime past the kind limit', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const jtis = new MemoryJtis();
    const fresh = await session(rig, aud);
    expect(await verifyToken(fresh.token, SECRET, opts(aud, jtis, NOW + 601_000))).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    const future = await session(rig, aud, {
      iat: nowSec + MAX_IAT_SKEW_S + 30,
      exp: nowSec + MAX_IAT_SKEW_S + 600,
    });
    expect(await verifyToken(future.token, SECRET, opts(aud, jtis))).toMatchObject({ ok: false });
    const long = await session(rig, aud, { exp: nowSec + TOKEN_TTL_S.session + 1 });
    expect(await verifyToken(long.token, SECRET, opts(aud, jtis))).toMatchObject({ ok: false });
  });

  it('refuses a revoked token and a replayed invite', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const jtis = new MemoryJtis();
    const { token, payload } = await session(rig, aud);
    jtis.revoked.add(payload.jti);
    expect(await verifyToken(token, SECRET, opts(aud, jtis))).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });

    const invite = await signToken(
      {
        kind: 'invite',
        aud,
        sub: 'guest',
        jti: rig.ids.mint<'MsgId'>(),
        iat: nowSec,
        exp: nowSec + 600,
      },
      SECRET,
    );
    const inviteOpts = { aud, kinds: ['invite'] as const, nowMs: NOW, jtis };
    expect(await verifyToken(invite, SECRET, inviteOpts)).toMatchObject({ ok: true });
    expect(await verifyToken(invite, SECRET, inviteOpts)).toMatchObject({
      ok: false,
      code: 'invite_used',
    });
  });

  it('fails closed when the revocation store throws', async () => {
    const rig = await newRig();
    const aud = rig.ids.mint<'AuctionId'>();
    const { token } = await session(rig, aud);
    const broken: JtiStore = {
      isRevoked: () => Promise.reject(new Error('store down')),
      consume: () => Promise.reject(new Error('store down')),
    };
    expect(await verifyToken(token, SECRET, opts(aud, broken))).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
  });
});

describe('server time orders bids (T-QA-079)', () => {
  it('stamps events with the server clock whatever clientTs claims', async () => {
    const rig = await newRig();
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const room = await service.createAuction(auctionId, CONFIG, 'auctioneer-sub');
    const ana = await enroll(rig, service, room, auctionId, 'Ana', 50000);
    const ben = await enroll(rig, service, room, auctionId, 'Ben', 50000);

    const stale = { ...bidMessage(rig, 10000, 'manual'), clientTs: 1_000 as unknown as EpochMs };
    await room.submitBid(ana.conn, stale);
    const serverAt = rig.clock.now();
    rig.clock.set(serverAt + 1000);
    const early = {
      ...bidMessage(rig, 10500, 'manual'),
      clientTs: (serverAt - 3_600_000) as unknown as EpochMs,
    };
    await room.submitBid(ben.conn, early);
    const late = {
      ...bidMessage(rig, 11000, 'manual'),
      clientTs: (serverAt + 86_400_000) as unknown as EpochMs,
    };
    rig.clock.set(serverAt + 2000);
    await room.submitBid(ana.conn, late);

    const events = await rig.stores.store.readEvents(auctionId, 1, 1000);
    const accepted = events.filter((e) => e.type === 'bid_accepted');
    expect(accepted.map((e) => e.ts)).toEqual([serverAt, serverAt + 1000, serverAt + 2000]);
    expect(accepted.map((e) => e.seq)).toEqual(
      [...accepted.map((e) => e.seq)].sort((a, b) => a - b),
    );
    expect(accepted.map((e) => (e.type === 'bid_accepted' ? e.amount : 0))).toEqual([
      10000, 10500, 11000,
    ]);
    await service.close();
  });
});
