import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { actionSchema, type Action } from "./action.js";

export type ControlRequest = {
  /** Idempotency key you mint. The same id with the same action is a repeat. */
  controlId: string;
  /** The control to apply. */
  action: Action;
  /**
   * `extend` needs `extraMs` (whole number, 1 to 600000). `hammer` needs `closeNow: 1` while the
   * lot is open.
   */
  args?: Record<string, number>;
};

export const controlRequestSchema: Schema<ControlRequest> = s.object<ControlRequest>({
  controlId: s.string(),
  action: actionSchema,
  args: s.optional(s.record(s.string(), s.float64())),
});
