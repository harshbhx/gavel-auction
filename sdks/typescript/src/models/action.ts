import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The control to apply. */
export const Action = {
  Open: "open",
  Pause: "pause",
  Resume: "resume",
  Extend: "extend",
  Hammer: "hammer",
} as const;
export type Action = (typeof Action)[keyof typeof Action] | (string & {});

export const actionSchema: EnumSchema<Action> = s.enumOf<Action>(Action);
