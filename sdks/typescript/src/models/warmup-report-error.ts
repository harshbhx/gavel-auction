import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { stepSchema, type Step } from "./step.js";

export type WarmupReportError = {
  /** True when every warm-up step succeeded. */
  ok: boolean;
  /** Total time of the warm-up in milliseconds. */
  elapsedMs: number;
  /** One entry per warm-up step, in the order they ran. */
  steps: Step[];
};

export const warmupReportErrorSchema: Schema<WarmupReportError> = s.object<WarmupReportError>({
  ok: s.boolean(),
  elapsedMs: s.int(),
  steps: s.array(s.lazy(() => stepSchema)),
});
