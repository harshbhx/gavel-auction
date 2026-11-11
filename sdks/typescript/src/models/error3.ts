import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/**
 * The error body. `message` is always there. The stable code is in `code` on the core and judge
 * routes and in `error` on the hold, judge and operator routes: read `code ?? error`. 413 and 415
 * use `bad_message`.
 */
export type Error3 = {
  /** Stable code (hold, judge and operator routes). */
  error?: string;
  /** Stable code (core and judge routes). One of ErrorCode. */
  code?: string;
  /** Text for a person. Never contains a token or a stack trace. */
  message?: string;
  /** Optional extra text, for example the failing field path and reason. */
  detail?: string;
};

export const error3Schema: Schema<Error3> = s.object<Error3>({
  error: s.optional(s.string()),
  code: s.optional(s.string()),
  message: s.optional(s.string()),
  detail: s.optional(s.string()),
});
