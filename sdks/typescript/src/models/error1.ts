import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Error1 = {
  /** Stable code (hold, judge and operator routes). */
  error: string;
  /** Stable code (core and judge routes). One of ErrorCode. */
  code?: string;
  /** Text for a person. Never contains a token or a stack trace. */
  message: string;
  /** Optional extra text, for example the failing field path and reason. */
  detail?: string;
};

export const error1Schema: Schema<Error1> = s.object<Error1>({
  error: s.string(),
  code: s.optional(s.string()),
  message: s.string(),
  detail: s.optional(s.string()),
});
