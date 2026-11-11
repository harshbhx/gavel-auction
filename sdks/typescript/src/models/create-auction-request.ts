import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { auctionConfigSchema, type AuctionConfig } from "./auction-config.js";

export type CreateAuctionRequest = {
  /** Lot title shown to bidders. @default "Untitled auction" */
  title?: string;
  /** Settings of one auction. Amounts are in cents, durations in milliseconds. */
  config: AuctionConfig;
  /** Optional goal; the projector shows a thermometer only when it is set. */
  fundraiserGoalCents?: number;
};

export const createAuctionRequestSchema: Schema<CreateAuctionRequest> = s.object<CreateAuctionRequest>({
  title: s.defaulted(s.string(), "Untitled auction"),
  config: auctionConfigSchema,
  fundraiserGoalCents: s.optional(s.int()),
});
