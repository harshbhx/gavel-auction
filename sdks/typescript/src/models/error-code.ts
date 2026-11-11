import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/**
 * Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount;
 * 401 unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used,
 * closed, already_leading, lot_not_open, unconfirmed, already_bid, auction_paused, conflict,
 * host_fenced; 422 below_increment, over_ceiling, below_reserve, not_higher_than_own_max,
 * limit_exceeded (these arise on the socket, in `bid_rejected`); 429 rate_limited; 500 internal;
 * 503 room_full, auction_full, room_cap, store_unavailable.
 */
export const ErrorCode = {
  BadMessage: "bad_message",
  UnsupportedVersion: "unsupported_version",
  NotJoined: "not_joined",
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  InviteUsed: "invite_used",
  RateLimited: "rate_limited",
  RoomFull: "room_full",
  AuctionFull: "auction_full",
  RoomCap: "room_cap",
  Unregistered: "unregistered",
  BelowIncrement: "below_increment",
  OverCeiling: "over_ceiling",
  BelowReserve: "below_reserve",
  Closed: "closed",
  AlreadyLeading: "already_leading",
  BadAmount: "bad_amount",
  LotNotOpen: "lot_not_open",
  CeilingRevoked: "ceiling_revoked",
  Unconfirmed: "unconfirmed",
  NotHigherThanOwnMax: "not_higher_than_own_max",
  AlreadyBid: "already_bid",
  LimitExceeded: "limit_exceeded",
  AuctionPaused: "auction_paused",
  StoreUnavailable: "store_unavailable",
  Conflict: "conflict",
  HostFenced: "host_fenced",
  NotFound: "not_found",
  Internal: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});

export const errorCodeSchema: EnumSchema<ErrorCode> = s.enumOf<ErrorCode>(ErrorCode);
