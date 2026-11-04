/**
 * Shared contract suite for the payments stores.
 *
 * For the author of a SQL adapter (realtime area): import the suite functions
 * and call each one with a factory that returns a FRESH, EMPTY store over a
 * clean database or schema.
 *
 *   journalStoreContract('sql', () => new SqlJournalStore(freshDb()));
 *   webhookStoreContract('sql', () => new SqlWebhookEventStore(freshDb()));
 *   holdStoreContract('sql', () => new SqlHoldStore(freshDb()));
 *
 * The behaviour every adapter must reproduce:
 *
 * JournalStore
 *  - load returns null when no journal exists, else a copy (mutating it never
 *    changes the stored journal).
 *  - create fails (rejects) when a journal for the auction already exists.
 *  - save(j, expectedVersion) is compare-and-set: it succeeds only when the
 *    stored journal's `version` equals expectedVersion, stores j exactly as
 *    given (callers bump j.version themselves), and otherwise rejects with an
 *    error whose name is "VersionConflict". Saving a journal that does not
 *    exist is a VersionConflict too. A failed save changes nothing.
 *  - acquireLease(auction, owner, ttlMs, nowMs) grants when there is no lease,
 *    the lease expired (expiresAt <= nowMs) or the owner already holds it (which
 *    renews it to nowMs + ttlMs). It returns false while another owner's lease
 *    is live.
 *  - releaseLease(auction, owner) frees the lease only for its owner; any other
 *    call is a no-op.
 *
 * WebhookEventStore
 *  - insertIfAbsent returns true for a new id and false for a duplicate, and a
 *    duplicate never overwrites the first row.
 *  - markProcessed sets `result` and clears any park; unknown ids reject.
 *  - parkOrphan sets `parkedUntilMs`; unknown ids reject.
 *  - listOrphans(now) returns unprocessed events with parkedUntilMs > now,
 *    oldest receivedAtMs first.
 *  - listUnprocessed returns every event without a result, parked or not,
 *    oldest receivedAtMs first.
 *
 * HoldStore
 *  - get returns null for unknown ids; put replaces by holdId.
 *  - byBidder returns the newest hold (createdAtMs) of the bidder in the
 *    auction, or null.
 *  - listByAuction returns the auction's holds ordered by createdAtMs, then
 *    holdId.
 */
import { describe, expect, it } from 'vitest';
import type { HoldStore, JournalStore, WebhookEventStore } from '../src/ports.js';
import type { HoldRecord, Journal, StoredWebhook } from '../src/types.js';

export function makeJournal(auctionId: string, version = 0): Journal {
  return {
    v: 1,
    auctionId,
    version,
    state: 'HELD',
    plan: {
      reserveCents: 5000,
      candidates: [
        { bidderId: 'b1', priceCents: 22000 },
        { bidderId: 'b2', priceCents: 21000 },
      ],
    },
    holds: {
      b1: { holdId: 'h1', authId: 'AUTH-1', ceilingCents: 30000, stale: false },
      b2: { holdId: 'h2', authId: 'AUTH-2', ceilingCents: 25000, stale: false },
    },
    cursor: 0,
    intent: null,
    unknownSince: null,
    winner: null,
    failed: [],
    voids: {},
    resumes: 0,
    history: [],
  };
}

async function rejectsWith(p: Promise<unknown>, name: string): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).name).toBe(name);
}

async function rejects(p: Promise<unknown>): Promise<void> {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
}

export function journalStoreContract(name: string, make: () => JournalStore): void {
  describe(`JournalStore contract: ${name}`, () => {
    it('load returns null for an unknown auction', async () => {
      expect(await make().load('a1')).toBeNull();
    });

    it('create then load round-trips and returns a copy', async () => {
      const s = make();
      const j = makeJournal('a1');
      await s.create(j);
      const loaded = await s.load('a1');
      expect(loaded).toEqual(j);
      if (loaded === null) throw new Error('missing journal');
      loaded.cursor = 99;
      j.state = 'BIDDING';
      expect((await s.load('a1'))?.cursor).toBe(0);
      expect((await s.load('a1'))?.state).toBe('HELD');
    });

    it('create fails when the journal exists', async () => {
      const s = make();
      await s.create(makeJournal('a1'));
      await rejects(s.create(makeJournal('a1')));
    });

    it('save succeeds with the expected version', async () => {
      const s = make();
      await s.create(makeJournal('a1', 0));
      const next = { ...makeJournal('a1', 1), state: 'BIDDING' as const };
      await s.save(next, 0);
      expect((await s.load('a1'))?.version).toBe(1);
      expect((await s.load('a1'))?.state).toBe('BIDDING');
    });

    it('save with a stale version throws VersionConflict and changes nothing', async () => {
      const s = make();
      await s.create(makeJournal('a1', 0));
      await s.save({ ...makeJournal('a1', 1), state: 'BIDDING' }, 0);
      await rejectsWith(
        s.save({ ...makeJournal('a1', 1), state: 'VOIDING' }, 0),
        'VersionConflict',
      );
      expect((await s.load('a1'))?.state).toBe('BIDDING');
    });

    it('save of a missing journal throws VersionConflict', async () => {
      await rejectsWith(make().save(makeJournal('nope', 1), 0), 'VersionConflict');
    });

    it('two writers with the same expected version: exactly one wins', async () => {
      const s = make();
      await s.create(makeJournal('a1', 0));
      const results = await Promise.allSettled([
        s.save({ ...makeJournal('a1', 1), state: 'BIDDING' }, 0),
        s.save({ ...makeJournal('a1', 1), state: 'VOIDING' }, 0),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('lease: acquire, refuse a second owner, renew for the same owner', async () => {
      const s = make();
      expect(await s.acquireLease('a1', 'r1', 30000, 1000)).toBe(true);
      expect(await s.acquireLease('a1', 'r2', 30000, 2000)).toBe(false);
      expect(await s.acquireLease('a1', 'r1', 30000, 20000)).toBe(true);
      // renewed to 50000: still live at 40000
      expect(await s.acquireLease('a1', 'r2', 30000, 40000)).toBe(false);
    });

    it('lease: expires at the ttl boundary', async () => {
      const s = make();
      expect(await s.acquireLease('a1', 'r1', 30000, 1000)).toBe(true);
      expect(await s.acquireLease('a1', 'r2', 30000, 30999)).toBe(false);
      expect(await s.acquireLease('a1', 'r2', 30000, 31000)).toBe(true);
    });

    it('lease: release frees it for the owner only', async () => {
      const s = make();
      await s.acquireLease('a1', 'r1', 30000, 1000);
      await s.releaseLease('a1', 'r2');
      expect(await s.acquireLease('a1', 'r2', 30000, 2000)).toBe(false);
      await s.releaseLease('a1', 'r1');
      expect(await s.acquireLease('a1', 'r2', 30000, 2000)).toBe(true);
      await s.releaseLease('nothing', 'r1');
    });

    it('leases are per auction', async () => {
      const s = make();
      expect(await s.acquireLease('a1', 'r1', 30000, 1000)).toBe(true);
      expect(await s.acquireLease('a2', 'r2', 30000, 1000)).toBe(true);
    });
  });
}

function hook(id: string, receivedAtMs: number, extra: Partial<StoredWebhook> = {}): StoredWebhook {
  return {
    id,
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    receivedAtMs,
    body: `{"id":"${id}"}`,
    ...extra,
  };
}

export function webhookStoreContract(name: string, make: () => WebhookEventStore): void {
  describe(`WebhookEventStore contract: ${name}`, () => {
    it('insertIfAbsent is true once, false for duplicates, first row wins', async () => {
      const s = make();
      expect(await s.insertIfAbsent(hook('e1', 10))).toBe(true);
      expect(await s.insertIfAbsent(hook('e1', 99, { body: 'other' }))).toBe(false);
      await s.parkOrphan('e1', 1000);
      const [first] = await s.listOrphans(0);
      expect(first?.body).toBe('{"id":"e1"}');
      expect(first?.receivedAtMs).toBe(10);
    });

    it('parked events list until their window ends, oldest first', async () => {
      const s = make();
      await s.insertIfAbsent(hook('e2', 20));
      await s.insertIfAbsent(hook('e1', 10));
      await s.insertIfAbsent(hook('e3', 30));
      await s.parkOrphan('e2', 600);
      await s.parkOrphan('e1', 600);
      expect((await s.listOrphans(100)).map((e) => e.id)).toEqual(['e1', 'e2']);
      expect((await s.listOrphans(599)).map((e) => e.id)).toEqual(['e1', 'e2']);
      expect(await s.listOrphans(600)).toEqual([]);
    });

    it('listUnprocessed returns stored events that were never parked or processed', async () => {
      const s = make();
      await s.insertIfAbsent(hook('e2', 20));
      await s.insertIfAbsent(hook('e1', 10));
      await s.insertIfAbsent(hook('e3', 30));
      await s.parkOrphan('e2', 600);
      await s.markProcessed('e3', 'ok');
      expect(await s.listOrphans(0).then((l) => l.map((e) => e.id))).toEqual(['e2']);
      expect((await s.listUnprocessed()).map((e) => e.id)).toEqual(['e1', 'e2']);
    });

    it('markProcessed removes the event from the orphan list and stores the result', async () => {
      const s = make();
      await s.insertIfAbsent(hook('e1', 10));
      await s.parkOrphan('e1', 600);
      await s.markProcessed('e1', 'applied');
      expect(await s.listOrphans(0)).toEqual([]);
      expect(await s.insertIfAbsent(hook('e1', 10))).toBe(false);
    });

    it('unknown ids reject', async () => {
      const s = make();
      await rejects(s.markProcessed('ghost', 'x'));
      await rejects(s.parkOrphan('ghost', 1));
    });

    it('listOrphans returns copies', async () => {
      const s = make();
      await s.insertIfAbsent(hook('e1', 10));
      await s.parkOrphan('e1', 600);
      const [a] = await s.listOrphans(0);
      if (a !== undefined) a.body = 'mutated';
      expect((await s.listOrphans(0))[0]?.body).toBe('{"id":"e1"}');
    });
  });
}

function holdRec(
  holdId: string,
  bidderId: string,
  createdAtMs: number,
  auctionId = 'a1',
): HoldRecord {
  return {
    holdId,
    auctionId,
    bidderId,
    orderId: `ORDER-${holdId}`,
    ceilingCents: 10000,
    status: 'PENDING_APPROVAL',
    createdAtMs,
  };
}

export function holdStoreContract(name: string, make: () => HoldStore): void {
  describe(`HoldStore contract: ${name}`, () => {
    it('get is null for an unknown hold and put replaces by holdId', async () => {
      const s = make();
      expect(await s.get('h1')).toBeNull();
      await s.put(holdRec('h1', 'b1', 1));
      await s.put({ ...holdRec('h1', 'b1', 1), status: 'HELD', authId: 'AUTH-1' });
      const h = await s.get('h1');
      expect(h?.status).toBe('HELD');
      expect(h?.authId).toBe('AUTH-1');
    });

    it('byBidder returns the newest hold of that bidder in that auction', async () => {
      const s = make();
      await s.put(holdRec('h1', 'b1', 1));
      await s.put(holdRec('h2', 'b1', 5));
      await s.put(holdRec('h3', 'b2', 9));
      await s.put(holdRec('h4', 'b1', 99, 'a2'));
      expect((await s.byBidder('a1', 'b1'))?.holdId).toBe('h2');
      expect(await s.byBidder('a1', 'nobody')).toBeNull();
      expect((await s.byBidder('a2', 'b1'))?.holdId).toBe('h4');
    });

    it('listByAuction filters and orders by createdAtMs then holdId', async () => {
      const s = make();
      await s.put(holdRec('h3', 'b3', 5));
      await s.put(holdRec('h1', 'b1', 5));
      await s.put(holdRec('h2', 'b2', 1));
      await s.put(holdRec('hx', 'b9', 0, 'a2'));
      expect((await s.listByAuction('a1')).map((h) => h.holdId)).toEqual(['h2', 'h1', 'h3']);
      expect(await s.listByAuction('empty')).toEqual([]);
    });

    it('returns copies', async () => {
      const s = make();
      const r = holdRec('h1', 'b1', 1);
      await s.put(r);
      r.status = 'VOIDED';
      expect((await s.get('h1'))?.status).toBe('PENDING_APPROVAL');
    });
  });
}
