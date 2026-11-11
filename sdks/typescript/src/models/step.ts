import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Step = {
  /** Name of the warm-up step. */
  name: string;
  /** True when this step succeeded. */
  ok: boolean;
  /** Time this step took in milliseconds. */
  ms: number;
};

export const stepSchema: Schema<Step> = s.object<Step>({
  name: s.string(),
  ok: s.boolean(),
  ms: s.int(),
});
