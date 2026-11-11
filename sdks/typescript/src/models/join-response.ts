import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type JoinResponse = {
  /** Session token for `Authorization` and for the WebSocket `join` frame. */
  sessionToken: string;
  /** 26 character id (Crockford base 32). */
  bidderId: string;
  /** WebSocket address, `wss://<host>/ws`. */
  wsUrl: string;
};

export const joinResponseSchema: Schema<JoinResponse> = s.object<JoinResponse>({
  sessionToken: s.string(),
  bidderId: s.string(),
  wsUrl: s.string(),
});
