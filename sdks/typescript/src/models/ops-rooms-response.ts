import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { roomSchema, type Room } from "./room.js";

export type OpsRoomsResponse = {
  rooms: Room[];
};

export const opsRoomsResponseSchema: Schema<OpsRoomsResponse> = s.object<OpsRoomsResponse>({
  rooms: s.array(s.lazy(() => roomSchema)),
});
