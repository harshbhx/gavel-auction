import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgeRoomsRequest = {
  /** @default "Sandbox demo lot" */
  title?: string;
  /** Optional goal; the projector shows a thermometer only when it is set. */
  fundraiserGoalCents?: number;
};

export const apiJudgeRoomsRequestSchema: Schema<ApiJudgeRoomsRequest> = s.object<ApiJudgeRoomsRequest>({
  title: s.defaulted(s.string(), "Sandbox demo lot"),
  fundraiserGoalCents: s.optional(s.int()),
});
