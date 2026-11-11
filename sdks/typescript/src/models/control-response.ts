import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ControlResponse = {
  /** Always true on success. @default "True" */
  ok?: "True";
  /** The controlId you sent. */
  controlId: string;
  /** The hammer frame, present when the control ended the lot. */
  hammer?: Record<string, unknown>;
};

export const controlResponseSchema: Schema<ControlResponse> = s.object<ControlResponse>({
  ok: s.defaulted(s.literal("True"), "True"),
  controlId: s.string(),
  hammer: s.optional(s.record(s.string(), s.unknown())),
});
