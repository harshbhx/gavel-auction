import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeRoomsSimHoldResponse = {
  holdId: string;
  /** @default "True" */
  simulated?: "True";
  ceilingCents: number;
};

export const apiJudgeRoomsSimHoldResponseSchema: Schema<ApiJudgeRoomsSimHoldResponse> =
  s.object<ApiJudgeRoomsSimHoldResponse>({
    holdId: s.string(),
    simulated: s.defaulted(s.literal("True"), "True"),
    ceilingCents: s.int(),
  });
