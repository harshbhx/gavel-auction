import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Invite = {
  /** 26 character id (Crockford base 32). */
  bidderId: string;
  /** Milliseconds since the Unix epoch. */
  expiresAt: number;
  /** Registration link with the invite token in the fragment. */
  link: string;
};

export const inviteSchema: Schema<Invite> = s.object<Invite>({
  bidderId: s.string(),
  expiresAt: s.int(),
  link: s.string(),
});
