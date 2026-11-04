import { useCallback, useSyncExternalStore } from 'react';
import { roomStore, type RoomStore } from '../store/roomStore';

/** Skew beyond this many milliseconds is worth a notice on the auctioneer console (R-WEB-026). */
export const SKEW_NOTICE_MS = 2000;

/** Server time in epoch ms: the local clock plus a measured offset. */
export function serverNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}

/** The skew to report: the absolute offset when it is over the limit, otherwise zero. */
export function skewFromOffset(offsetMs: number): number {
  const skew = Math.abs(offsetMs);
  return skew > SKEW_NOTICE_MS ? skew : 0;
}

/** Returns a function that reads the current server time using the latest offset estimate. */
export function useServerNow(store: RoomStore = roomStore): () => number {
  const offsetMs = useSyncExternalStore(store.subscribe, store.getClockOffsetMs);
  return useCallback(() => serverNow(offsetMs), [offsetMs]);
}

/**
 * Skew in ms between this device and the server, or 0 when it is within the limit. Only the
 * auctioneer console reads this to show its notice; bidder screens never do.
 */
export function useSkew(store: RoomStore = roomStore): number {
  return useSyncExternalStore(store.subscribe, () => skewFromOffset(store.getClockOffsetMs()));
}
