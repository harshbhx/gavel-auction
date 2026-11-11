import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiJudgePauseRequest = {
  paused: boolean;
};

export const apiJudgePauseRequestSchema: Schema<ApiJudgePauseRequest> = s.object<ApiJudgePauseRequest>({
  paused: s.boolean(),
});
