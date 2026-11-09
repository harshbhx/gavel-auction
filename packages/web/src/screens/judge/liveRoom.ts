import { hubFragment, type KnownRoom } from '../hub/hubKeys';

/** What /try can honestly show about a room this tab already made: real code, real links. */
export interface LiveRoom {
  readonly roomId: string;
  readonly code: string | null;
  /** Null when this tab has no console key for the room. */
  readonly console: string | null;
  readonly screen: string | null;
  readonly receipt: string;
  readonly hub: string;
  /** Path of the join page, with the code when there is one. */
  readonly join: string;
}

export function liveRoomFrom(known: KnownRoom | null): LiveRoom | null {
  if (known === null) return null;
  const { roomId, keys } = known;
  const base = `/r/${encodeURIComponent(roomId)}`;
  const code = keys.code;
  return {
    roomId,
    code,
    console: keys.auctioneer === null ? null : `${base}/console#token=${keys.auctioneer}`,
    screen: keys.screen === null ? null : `${base}/screen#token=${keys.screen}`,
    receipt: `${base}/receipt`,
    hub: `${base}/hub${hubFragment(keys)}`,
    join: `/join/${encodeURIComponent(roomId)}${code === null ? '' : `?c=${encodeURIComponent(code)}`}`,
  };
}
