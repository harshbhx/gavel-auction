import type { RoomEvent, ServerMsg } from '@gavel/shared';

/** The most events a reconnecting client may have missed and still get a replay (R-RT-057). */
export const MAX_REPLAY_EVENTS = 200;
/** Concurrent connections one session token may hold (R-RT-058). */
export const MAX_CONNECTIONS_PER_TOKEN = 3;
/** Close code and reason for the oldest connection beyond the cap. */
export const SUPERSEDED_CODE = 4011;
export const SUPERSEDED_REASON = 'superseded';

export type ResyncPlan =
  | { kind: 'state-only' }
  /** Replay events `from` to `to` (inclusive), then send state. */
  | { kind: 'replay'; from: number; to: number };

/**
 * Decide how a join with `lastSeq` is served. A gap of at most 200 events is replayed;
 * a client that is current, ahead of the room or too far behind gets `state` only.
 */
export function planResync(lastSeq: number | undefined, currentSeq: number): ResyncPlan {
  if (lastSeq === undefined || lastSeq >= currentSeq) return { kind: 'state-only' };
  const gap = currentSeq - lastSeq;
  if (gap > MAX_REPLAY_EVENTS) return { kind: 'state-only' };
  return { kind: 'replay', from: lastSeq + 1, to: currentSeq };
}

/**
 * The frames a stored event stands for on the wire. Only events that carry an audit row have
 * a visible frame; the snapshot that follows the replay covers everything else.
 */
export function eventFrames(event: RoomEvent, fullAudit = false): ServerMsg[] {
  if (!('audit' in event)) return [];
  // A confirm answer is not a bid: an accepted one is followed by the bid's own audit row, so
  // replaying it would show a second (or phantom) accepted bid. Only the auctioneer sees the
  // other confirm rows (R-RT-045).
  if (event.type === 'confirm_requested' || event.type === 'confirm_resolved') {
    if (!fullAudit) return [];
    if (event.type === 'confirm_resolved' && event.outcome === 'accepted') return [];
  }
  return [{ v: 1, t: 'audit_event', seq: event.seq, ts: event.ts, audit: event.audit }];
}
