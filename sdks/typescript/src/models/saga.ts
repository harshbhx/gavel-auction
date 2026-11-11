import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Saga = {
  auctionId: string;
  lotId: string;
  state: string;
};

export const sagaSchema: Schema<Saga> = s.object<Saga>({
  auctionId: s.string(),
  lotId: s.string(),
  state: s.string(),
});
