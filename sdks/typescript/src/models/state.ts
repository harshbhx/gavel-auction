import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { auctionStatusSchema, type AuctionStatus } from "./auction-status.js";

export type State = {
  /** Lifecycle state of the auction, from SCHEDULED to DONE. */
  status: AuctionStatus;
  stopped: boolean;
  registrationClosed: boolean;
};

export const stateSchema: Schema<State> = s.object<State>({
  status: auctionStatusSchema,
  stopped: s.boolean(),
  registrationClosed: s.boolean(),
});
