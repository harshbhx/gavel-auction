import type { RoomStore } from '@gavel/shared';
import type { TokenPayload } from './token';

type FloorStore = Pick<RoomStore, 'getJournal' | 'putJournal'>;

const keyOf = (auctionId: string): string => `auctioneer-floor:${auctionId}`;

/**
 * Per-auction "not before" in epoch seconds. An auctioneer token issued before it is dead,
 * whatever its jti (R-RT-084). Kept in the store journal so it survives a restart.
 */
export async function readAuctioneerFloor(store: FloorStore, auctionId: string): Promise<number> {
  const slot = await store.getJournal(keyOf(auctionId));
  const v = slot?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Raise the floor to at least `floorSec`; never lowers it. Returns the stored floor. */
export async function raiseAuctioneerFloor(
  store: FloorStore,
  auctionId: string,
  floorSec: number,
): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slot = await store.getJournal(keyOf(auctionId));
    const current = typeof slot?.value === 'number' ? slot.value : 0;
    if (current >= floorSec) return current;
    try {
      await store.putJournal(keyOf(auctionId), slot?.version ?? 0, floorSec);
      return floorSec;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  return floorSec;
}

/** True when the token may still act: not an auctioneer token, or issued at or after the floor. */
export async function auctioneerTokenLive(
  store: FloorStore,
  payload: Pick<TokenPayload, 'kind' | 'aud' | 'iat'>,
): Promise<boolean> {
  if (payload.kind !== 'auctioneer') return true;
  return payload.iat >= (await readAuctioneerFloor(store, payload.aud));
}

/** The token facts a socket keeps from its join, so it can be re-checked later. */
export interface ConnectionToken {
  jti: string;
  iat: number;
  exp: number;
  kind: string;
}

/**
 * True while the token behind an open socket is still good: not expired, its jti not on the
 * denylist, and (for an auctioneer token) issued at or after the current floor.
 */
export async function connectionTokenLive(
  store: FloorStore & Pick<RoomStore, 'isDenied'>,
  auctionId: string,
  token: ConnectionToken,
  nowMs: number,
): Promise<boolean> {
  if (token.exp * 1000 <= nowMs) return false;
  if (await store.isDenied(token.jti as Parameters<RoomStore['isDenied']>[0])) return false;
  if (token.kind !== 'auctioneer') return true;
  return token.iat >= (await readAuctioneerFloor(store, auctionId));
}
