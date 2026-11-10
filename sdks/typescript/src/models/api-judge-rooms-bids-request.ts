import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeRoomsBidsRequest = {
  /** Bid in cents. */
  amount: number;
  /** Optional message id (ULID) that makes a retry safe. */
  mid?: string;
};

export const apiJudgeRoomsBidsRequestSchema: Schema<ApiJudgeRoomsBidsRequest> =
  s.object<ApiJudgeRoomsBidsRequest>({
    amount: s.int(),
    mid: s.optional(s.string()),
  });
