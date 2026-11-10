import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { errorCodeSchema, type ErrorCode } from "./error-code.js";
import { error4Schema, type Error4 } from "./error4.js";

export type ApiJudgeRoomsBids409Error = {
  accepted?: boolean;
  /** Stable code (hold, judge and operator routes). */
  error?: Error4;
  mid?: string;
  /**
   * Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined,
   * bad_amount; 401 unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409
   * invite_used, closed, already_leading, lot_not_open, unconfirmed, already_bid, auction_paused,
   * conflict, host_fenced; 422 below_increment, over_ceiling, below_reserve,
   * not_higher_than_own_max, limit_exceeded (these arise on the socket, in `bid_rejected`); 429
   * rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable.
   */
  reason?: ErrorCode;
  retryable?: boolean;
  /** Stable code (core and judge routes). One of ErrorCode. */
  code?: string;
  /** Text for a person. Never contains a token or a stack trace. */
  message?: string;
  /** Optional extra text, for example the failing field path and reason. */
  detail?: string;
};

export const apiJudgeRoomsBids409ErrorSchema: Schema<ApiJudgeRoomsBids409Error> =
  s.object<ApiJudgeRoomsBids409Error>({
    accepted: s.optional(s.boolean()),
    error: s.optional(s.lazy(() => error4Schema)),
    mid: s.optional(s.string()),
    reason: s.optional(s.lazy(() => errorCodeSchema)),
    retryable: s.optional(s.boolean()),
    code: s.optional(s.string()),
    message: s.optional(s.string()),
    detail: s.optional(s.string()),
  });
