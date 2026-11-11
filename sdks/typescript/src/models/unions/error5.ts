import * as s from "../../core/validation/index.js";
import type { Schema } from "../../core/validation/schema.js";
import { errorSchema, type Error } from "../error.js";
import { error1Schema, type Error1 } from "../error1.js";
import { error2Schema, type Error2 } from "../error2.js";

/**
 * The error body. `message` is always there. The stable code is in `code` on the core and judge
 * routes and in `error` on the hold, judge and operator routes: read `code ?? error`. 413 and 415
 * use `bad_message`.
 */
export type Error5 = Error | Error1 | Error2;

export const error5Schema: Schema<Error5> = s.of<Error5>(
  s.union([s.lazy(() => errorSchema), s.lazy(() => error1Schema), s.lazy(() => error2Schema)]),
);
