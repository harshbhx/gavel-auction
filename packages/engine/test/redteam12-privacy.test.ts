import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import { decide } from '../src/decide/index.js';
import { evolve } from '../src/evolve.js';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { genesisHead, hashEntry, sealBatch } from '../src/ledger/chain.js';
import { matchesLedger, publicExport, verifyPublicExport } from '../src/ledger/public-export.js';
import type { PublicEntry } from '../src/ledger/public-export.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { LotConfig, Mode, Ulid } from '../src/types.js';
import { A, AU, B, C, L1, id, lotConfig, mk } from './decide-helpers.js';
import { SEED, runsFor } from './property-params.js';

/** Decides commands and seals the entries with real hashes, as a store would. */
function recorder(): {
  apply: (cmd: Command) => void;
  entries: LedgerEntry[];
  state: () => AuctionState;
} {
  let s = initialState;
  const entries: LedgerEntry[] = [];
  return {
    apply(cmd) {
      const r = decide(s, cmd);
      const head = { auctionId: AU, seq: s.head.seq, hash: s.head.hash };
      const sealed = sealBatch(r.events, head, cmd.at, cmd.commandId);
      s = sealed.reduce(evolve, s);
      entries.push(...sealed);
    },
    entries,
    state: () => s,
  };
}

const place = (at: number, bidderId: Ulid, amountCents: number, audit = {}, lotId = L1) =>
  mk(at, {
    type: 'PlaceBid',
    lotId,
    bidderId,
    amountCents,
    source: Object.keys(audit).length > 0 ? 'voice' : 'manual',
    audit,
  });

/** Every number anywhere inside the public payloads. */
function numbersIn(pub: readonly PublicEntry[]): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown): void => {
    if (typeof v === 'number') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
  };
  pub.forEach((e) => walk(e.payload));
  return out;
}

const PRESETS = [25_000, 50_000, 100_000, 200_000];

/**
 * The R12-E01 attack: from the last published private hash before the first redaction, rebuild
 * each private entry from its public copy plus a guess of the ceilings (leaders of an english
 * lot are deducible) and hash forward. Returns every hash the guess produces.
 */
function forwardHashes(pub: readonly PublicEntry[], guess: readonly number[]): string[] {
  const first = pub.findIndex((e) => e.redacted.length > 0);
  let prev = (pub[first - 1] as PublicEntry).fullHash as string;
  let leader: string | null = null;
  let g = 0;
  const out: string[] = [];
  for (const p of pub.slice(first)) {
    const payload: Record<string, unknown> = { ...p.payload };
    if (p.type === 'BIDDER_REGISTERED') payload['ceilingCents'] = guess[g++];
    if (p.type === 'BID_RECORDED') {
      payload['leaderBefore'] = leader;
      payload['leaderAfter'] = payload['bidderId'];
      payload['rank'] = 1;
      leader = payload['bidderId'] as string;
    }
    const entry = {
      v: 1,
      auctionId: p.auctionId,
      seq: p.seq,
      at: p.at,
      type: p.type,
      cmd: p.cmd,
      payload,
      prev,
      hash: '',
    } as unknown as LedgerEntry;
    prev = hashEntry(entry);
    out.push(prev);
  }
  return out;
}

describe('red team round 12 public export privacy', () => {
  it('T-ENG-087 R12-E01 no later entry commits to a redacted ceiling through its private hash', () => {
    const r = recorder();
    r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
    r.apply(mk(2, { type: 'AddLot', lot: lotConfig(L1) }));
    r.apply(mk(3, { type: 'RegisterBidder', bidderId: A, ceilingCents: 50_000 }));
    r.apply(mk(4, { type: 'RegisterBidder', bidderId: B, ceilingCents: 100_000 }));
    r.apply(mk(5, { type: 'OpenLot', lotId: L1 }));
    r.apply(place(10, A, 2000));
    r.apply(place(11, B, 2100));
    r.apply(mk(12, { type: 'PauseLot', lotId: L1, actor: 'host' }));
    r.apply(mk(13, { type: 'ResumeLot', lotId: L1, actor: 'host' }));
    r.apply(mk(14, { type: 'Hammer', lotId: L1, actor: 'host', early: true }));
    const pub = publicExport(r.entries);
    // The rebuild is right: the true ceilings give back the private hashes.
    const truth = forwardHashes(pub, [50_000, 100_000]);
    const firstRedacted = pub.findIndex((e) => e.redacted.length > 0);
    expect(truth).toEqual(r.entries.slice(firstRedacted).map((e) => e.hash));
    // Yet no guess, the true one included, meets anything the export publishes.
    const text = JSON.stringify(pub);
    const hits: number[][] = [];
    for (const a of PRESETS) {
      for (const b of PRESETS) {
        if (forwardHashes(pub, [a, b]).some((h) => text.includes(h))) hits.push([a, b]);
      }
    }
    expect(hits).toEqual([]);
    for (const e of pub.slice(firstRedacted)) expect(e.fullHash).toBeNull();
    // Entries before the first redaction are public in full and keep the private hash.
    for (const e of pub.slice(0, firstRedacted))
      expect(e.fullHash).toBe(r.entries[e.seq - 1]?.hash);
    expect(matchesLedger(pub, r.entries)).toBe(true);
  });

  it('T-ENG-087 R12-E01 property: from the first redaction on no private hash is published', () => {
    const modes = fc.constantFrom<Mode>('english', 'proxy', 'second_price');
    const step = fc.record({
      who: fc.integer({ min: 0, max: 2 }),
      amount: fc.integer({ min: 900, max: 60_000 }),
      kind: fc.constantFrom('bid', 'bid', 'bid', 'register', 'pause'),
    });
    fc.assert(
      fc.property(modes, fc.array(step, { minLength: 1, maxLength: 12 }), (mode, steps) => {
        const r = recorder();
        r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
        r.apply(mk(2, { type: 'AddLot', lot: lotConfig(L1, { mode }) }));
        r.apply(mk(3, { type: 'OpenLot', lotId: L1 }));
        let at = 10;
        const who = [A, B, C];
        const registered = new Set<Ulid>();
        let paused = false;
        for (const st of steps) {
          at += 1;
          const bidder = who[st.who] as Ulid;
          if (st.kind === 'register' && !registered.has(bidder)) {
            r.apply(mk(at, { type: 'RegisterBidder', bidderId: bidder, ceilingCents: st.amount }));
            registered.add(bidder);
          } else if (st.kind === 'pause') {
            r.apply(
              paused
                ? mk(at, { type: 'ResumeLot', lotId: L1, actor: 'h' })
                : mk(at, { type: 'PauseLot', lotId: L1, actor: 'h' }),
            );
            paused = !paused;
          } else if (st.kind === 'bid') {
            r.apply(place(at, bidder, st.amount));
          }
        }
        if (paused) r.apply(mk(at, { type: 'ResumeLot', lotId: L1, actor: 'h' }));
        r.apply(mk(at + 1, { type: 'Hammer', lotId: L1, actor: 'h', early: true }));
        for (const opts of [{}, { commitKey: 'r12' }]) {
          const pub = publicExport(r.entries, undefined, opts);
          expect(verifyPublicExport(pub).ok).toBe(true);
          expect(matchesLedger(pub, r.entries, undefined, opts)).toBe(true);
          const first = pub.findIndex((e) => e.redacted.length > 0);
          const from = first === -1 ? pub.length : first;
          const text = JSON.stringify(pub);
          for (const e of r.entries.slice(from)) expect(text).not.toContain(e.hash);
          for (const e of pub.slice(0, from)) expect(e.fullHash).toBe(r.entries[e.seq - 1]?.hash);
        }
      }),
      { seed: SEED, numRuns: runsFor('redteam12-privacy', 200) },
    );
  });

  it('T-ENG-087 R12-E05 an english voice bid and rejection lose the transcript in public', () => {
    const r = recorder();
    r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
    r.apply(mk(2, { type: 'AddLot', lot: lotConfig(L1) }));
    r.apply(mk(3, { type: 'RegisterBidder', bidderId: A, ceilingCents: 90_000 }));
    r.apply(mk(4, { type: 'OpenLot', lotId: L1 }));
    const spoken = {
      transcript: 'one fifty from the back, Mary',
      confidenceBps: 9500,
      utteranceId: 'u1',
    };
    r.apply(place(10, A, 1500, spoken));
    r.apply(place(11, A, 1700, { ...spoken, utteranceId: 'u2' }));
    const pub = publicExport(r.entries);
    expect(JSON.stringify(pub)).not.toContain('Mary');
    const accepted = pub.find((e) => e.type === 'BID_RECORDED') as PublicEntry;
    const rejected = pub.find((e) => e.type === 'BID_REJECTED') as PublicEntry;
    expect(rejected.payload['reason']).toBe('already_leading');
    for (const e of [accepted, rejected]) {
      expect(e.redacted).toContain('audit.transcript');
      expect(e.payload['audit']).toEqual({ confidenceBps: 9500, utteranceId: expect.any(String) });
    }
    // The amounts of an english lot stay public.
    expect(accepted.payload['amountCents']).toBe(1500);
    expect(rejected.payload['amountCents']).toBe(1700);
  });

  it('T-ENG-153 R12-E06 the public proxy hammer hides the runner-up prices that reveal maxima', () => {
    const r = recorder();
    const proxyLot: LotConfig = lotConfig(L1, { mode: 'proxy' });
    r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
    r.apply(mk(2, { type: 'AddLot', lot: proxyLot }));
    for (const b of [A, B, C])
      r.apply(mk(3, { type: 'RegisterBidder', bidderId: b, ceilingCents: 90_000 }));
    r.apply(mk(4, { type: 'OpenLot', lotId: L1 }));
    r.apply(place(10, A, 9137));
    r.apply(place(11, B, 5003));
    r.apply(place(12, C, 4219));
    r.apply(mk(13, { type: 'Hammer', lotId: L1, actor: 'host', early: true }));
    const priv = r.entries.find((e) => e.type === 'LOT_HAMMERED');
    const cands = (priv?.payload as { candidates: { priceCents: number }[] }).candidates;
    // B's fallback price is C's maximum plus the increment; C's maximum is never a price.
    expect(cands.map((c) => c.priceCents)).toEqual([5103, 4319, 1000]);
    const pub = publicExport(r.entries);
    const hammer = pub.find((e) => e.type === 'LOT_HAMMERED') as PublicEntry;
    expect(hammer.payload['priceCents']).toBe(5103);
    expect(hammer.redacted).toEqual(
      expect.arrayContaining(['candidates.priceCents', 'ranking.amountCents']),
    );
    const pubCands = hammer.payload['candidates'] as Record<string, unknown>[];
    expect(pubCands.map((c) => c['bidderId'])).toEqual([A, B, C]);
    expect(pubCands[0]?.['priceCents']).toBe(5103);
    expect(pubCands.slice(1).every((c) => !('priceCents' in c))).toBe(true);
    const seen = numbersIn(pub);
    for (const secret of [9137, 4219, 4319]) expect(seen.has(secret)).toBe(false);
  });

  it('T-ENG-087 R12-E07 an over_ceiling rejection keeps no amount, other rejections keep theirs', () => {
    const r = recorder();
    r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
    r.apply(mk(2, { type: 'AddLot', lot: lotConfig(L1) }));
    r.apply(mk(3, { type: 'RegisterBidder', bidderId: A, ceilingCents: 9000 }));
    r.apply(mk(3, { type: 'RegisterBidder', bidderId: B, ceilingCents: 90_000 }));
    r.apply(mk(4, { type: 'OpenLot', lotId: L1 }));
    r.apply(place(10, A, 8500));
    r.apply(place(11, A, 9500));
    r.apply(place(12, B, 8550));
    const pub = publicExport(r.entries);
    const [over, short] = pub.filter((e) => e.type === 'BID_REJECTED') as PublicEntry[];
    expect(over?.payload['reason']).toBe('over_ceiling');
    expect(over?.payload['amountCents']).toBeUndefined();
    expect(over?.redacted).toContain('amountCents');
    expect(numbersIn(pub).has(9500)).toBe(false);
    expect(short?.payload['reason']).toBe('below_increment');
    expect(short?.payload['amountCents']).toBe(8550);
  });

  it('T-ENG-087 R12-E07 a skipped candidate is published without the reason and price', () => {
    const events = [
      { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } },
      { type: 'LOT_ADDED', payload: { lotId: L1, lot: lotConfig(L1) } },
      {
        type: 'CANDIDATE_SKIPPED',
        payload: {
          lotId: L1,
          bidderId: B,
          reason: 'ceiling_insufficient',
          depth: 1,
          priceCents: 4321,
        },
      },
    ] as unknown as LedgerEvent[];
    const full = sealBatch(events, genesisHead(id('AAA')), 100, null);
    const skip = publicExport(full)[2] as PublicEntry;
    expect(skip.payload).toEqual({ lotId: L1, bidderId: B, depth: 1 });
    expect(skip.redacted).toEqual(['priceCents', 'reason']);
    expect(skip.fullHash).toBeNull();
  });
});
