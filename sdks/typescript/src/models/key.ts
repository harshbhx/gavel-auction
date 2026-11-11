import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Key = {
  id: string;
  label: string;
  maxRooms: number;
  perHour: number;
  roomsLive: number;
  revoked: boolean;
  expired: boolean;
  expiresAt?: Date;
};

export const keySchema: Schema<Key> = s.object<Key>({
  id: s.string(),
  label: s.string(),
  maxRooms: s.int(),
  perHour: s.int(),
  roomsLive: s.int(),
  revoked: s.boolean(),
  expired: s.boolean(),
  expiresAt: s.optional(s.dateTime()),
});
