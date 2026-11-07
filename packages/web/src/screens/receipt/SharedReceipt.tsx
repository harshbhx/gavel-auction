import { useEffect, useState } from 'react';
import { Cents, EpochMs, RoomSnapshotSchema, type RoomSnapshot } from '@gavel/shared';

import { t } from '../../copy/t';
import { initialRoomState, type RoomState } from '../../store/roomReducer';
import { Loading } from '../states/States';
import { ReceiptView } from './ReceiptView';
import type { MintReceiptLink } from './ShareControls';

/** Mints a receipt link for the signed-in bidder: the session token goes out, a receipt token comes back. */
export function mintReceiptLink(
  apiBase: string,
  roomId: string,
  sessionToken: string,
  origin: string = window.location.origin,
): MintReceiptLink {
  return async () => {
    try {
      const res = await fetch(
        `${apiBase}/api/auctions/${encodeURIComponent(roomId)}/receipt-link`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
          body: '{}',
        },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { token?: unknown; expiresAt?: unknown };
      if (typeof body.token !== 'string' || typeof body.expiresAt !== 'number') return null;
      return {
        link: `${origin}/r/${encodeURIComponent(roomId)}/receipt#token=${body.token}`,
        expiresAt: body.expiresAt,
      };
    } catch {
      return null;
    }
  };
}

/**
 * The room state a shared receipt needs, built from the cut-down snapshot of the receipt route:
 * the hammer outcome and the holder's own hold come from the snapshot, the settle time stays
 * unknown (so it is never shown) and nothing live is joined.
 */
export function sharedReceiptState(
  snapshot: RoomSnapshot,
  roomId: string,
  bidderId: string,
): RoomState {
  const base = initialRoomState(roomId);
  const holder = snapshot.roster.find((r) => r.bidderId === bidderId);
  const hammer = snapshot.hammer;
  return {
    ...base,
    snapshot,
    lastSeq: 0,
    me:
      holder === undefined
        ? null
        : { bidderId: holder.bidderId, paddle: holder.paddle, ceiling: null },
    expectedBidderId: holder?.bidderId ?? null,
    hammer:
      hammer === undefined
        ? null
        : {
            v: 1,
            t: 'hammer',
            seq: 0,
            ts: EpochMs(0),
            winnerId: hammer.winnerId,
            price: Cents(hammer.price),
            ranking: [],
          },
    ...(snapshot.settlement?.yourHold === undefined
      ? {}
      : { ownHold: snapshot.settlement.yourHold }),
  };
}

type Loaded = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'ready'; state: RoomState };

/**
 * A receipt opened from a share link, signed out: the receipt token is the only credential, and it
 * opens this one read-only fetch. An expired, altered or foreign token shows one plain message.
 */
export function SharedReceiptRoute({
  apiBase,
  roomId,
  token,
}: {
  apiBase: string;
  roomId: string;
  token: string;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}/receipt`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('refused');
        const body = (await res.json()) as { snapshot?: unknown; bidderId?: unknown };
        const parsed = RoomSnapshotSchema.safeParse(body.snapshot);
        if (!parsed.success || typeof body.bidderId !== 'string') throw new Error('bad receipt');
        const bidderId = body.bidderId;
        if (live) {
          setLoaded({
            kind: 'ready',
            state: sharedReceiptState(parsed.data, parsed.data.auctionId, bidderId),
          });
        }
      })
      .catch(() => {
        if (live) setLoaded({ kind: 'invalid' });
      });
    return () => {
      live = false;
    };
  }, [apiBase, roomId, token]);

  if (loaded.kind === 'loading') {
    return (
      <main data-route="receipt" data-shared="true">
        <Loading view="receipt" />
        <p role="status">{t('receipt.shared.loading')}</p>
      </main>
    );
  }
  if (loaded.kind === 'invalid') {
    return (
      <main data-route="receipt" data-shared="true">
        <p role="alert">{t('receipt.shared.invalid')}</p>
      </main>
    );
  }
  return <ReceiptView state={loaded.state} roomId={roomId} shared />;
}
