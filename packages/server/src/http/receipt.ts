import { GavelError, type RoomSnapshot } from '@gavel/shared';
import { auctionIdOf, authenticate, json, mintToken, type Ctx, type HttpApp } from './app';
import { auctionMeta, linkFor, roomFor, snapshotFor, withMeta } from './auctions';

/**
 * Cut a bidder snapshot down to what a shared receipt shows: the auction and its lot title, the
 * hammer outcome, the viewer's own roster row (display name and paddle) and own hold. The winner
 * keeps a paddle but loses the name, every other bidder is dropped, and the ceiling, the join code
 * and the audit rows are removed.
 */
export function receiptSnapshot(snapshot: RoomSnapshot, bidderId: string): RoomSnapshot | null {
  const own = snapshot.roster.find((r) => r.bidderId === bidderId);
  if (own === undefined) return null;
  const winnerId = snapshot.hammer?.winnerId ?? null;
  const roster = snapshot.roster
    .filter((r) => r.bidderId === bidderId || r.bidderId === winnerId)
    .map((r) => (r.bidderId === bidderId ? r : { ...r, name: '' }));
  const copy: RoomSnapshot = { ...snapshot, roster, recentAudit: [], leaderId: null };
  delete copy.you;
  delete copy.joinCode;
  return copy;
}

/**
 * Shareable receipt routes. The link carries a receipt token: signed with the same secrets as every
 * other token, but of its own kind, so each other route refuses it and it refuses theirs. It names
 * one bidder, opens exactly one read-only route and expires with the bidder session lifetime.
 *
 *   POST /api/auctions/:id/receipt-link   session token in, receipt link out
 *   GET  /api/auctions/:id/receipt        receipt token in, the cut-down snapshot out
 */
export function mountReceipt(app: HttpApp): void {
  app.post('/api/auctions/:id/receipt-link', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['session']);
    if (who.bidderId === undefined) throw new GavelError('forbidden', 'not allowed');
    await roomFor(c.deps, auctionId);
    const minted = await mintToken(c.deps, 'receipt', auctionId, who.bidderId);
    return json(200, {
      token: minted.token,
      link: linkFor(c.deps, auctionId, 'receipt', minted.token),
      expiresAt: minted.exp * 1000,
    });
  });

  app.get('/api/auctions/:id/receipt', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['receipt']);
    const room = await roomFor(c.deps, auctionId);
    const { snapshot } = await snapshotFor(c.deps, room, 'bidder', who.sub, who.sub);
    const cut = receiptSnapshot(withMeta(snapshot, await auctionMeta(c.deps, auctionId)), who.sub);
    if (cut === null) throw new GavelError('not_found', 'no receipt for this link');
    return json(200, { bidderId: who.sub, snapshot: cut, expiresAt: who.exp * 1000 });
  });
}
