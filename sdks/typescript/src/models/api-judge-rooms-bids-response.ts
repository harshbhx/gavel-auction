import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeRoomsBidsResponse = {
  /** @default "True" */
  accepted?: "True";
  mid: string;
  bidId: string;
  /** The accepted bid in cents. */
  amount: number;
  /** Position of the bid in the room's event log. */
  seq: number;
};

export const apiJudgeRoomsBidsResponseSchema: Schema<ApiJudgeRoomsBidsResponse> =
  s.object<ApiJudgeRoomsBidsResponse>({
    accepted: s.defaulted(s.literal("True"), "True"),
    mid: s.string(),
    bidId: s.string(),
    amount: s.int(),
    seq: s.int(),
  });
