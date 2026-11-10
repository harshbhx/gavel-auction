import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeRoomsBidsResponse1 = {
  /** @default "False" */
  accepted?: "False";
  /** @default "True" */
  pending?: "True";
  mid: string;
};

export const apiJudgeRoomsBidsResponse1Schema: Schema<ApiJudgeRoomsBidsResponse1> =
  s.object<ApiJudgeRoomsBidsResponse1>({
    accepted: s.defaulted(s.literal("False"), "False"),
    pending: s.defaulted(s.literal("True"), "True"),
    mid: s.string(),
  });
