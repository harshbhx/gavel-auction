import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { errorCodeSchema, type ErrorCode } from "./error-code.js";

export type ApiJudgeRoomsBidsResponse2 = {
  /** @default "False" */
  accepted?: "False";
  /** @default "bid_rejected" */
  error?: "bid_rejected";
  mid: string;
  /**
   * Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined,
   * bad_amount; 401 unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409
   * invite_used, closed, already_leading, lot_not_open, unconfirmed, already_bid, auction_paused,
   * conflict, host_fenced; 422 below_increment, over_ceiling, below_reserve,
   * not_higher_than_own_max, limit_exceeded (these arise on the socket, in `bid_rejected`); 429
   * rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable.
   */
  reason: ErrorCode;
  retryable: boolean;
};

export const apiJudgeRoomsBidsResponse2Schema: Schema<ApiJudgeRoomsBidsResponse2> =
  s.object<ApiJudgeRoomsBidsResponse2>({
    accepted: s.defaulted(s.literal("False"), "False"),
    error: s.defaulted(s.literal("bid_rejected"), "bid_rejected"),
    mid: s.string(),
    reason: errorCodeSchema,
    retryable: s.boolean(),
  });
