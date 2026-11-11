import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Room = {
  auctionId: string;
  seq: number;
  status: string;
  connections: number;
  mailboxDepth: number;
};

export const roomSchema: Schema<Room> = s.object<Room>({
  auctionId: s.string(),
  seq: s.int(),
  status: s.string(),
  connections: s.int(),
  mailboxDepth: s.int(),
});
