import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { roomEventSchema, type RoomEvent } from "./room-event.js";

export type ApiAuctionsEventsResponse = {
  events: RoomEvent[];
  next: number;
};

export const apiAuctionsEventsResponseSchema: Schema<ApiAuctionsEventsResponse> =
  s.object<ApiAuctionsEventsResponse>({
    events: s.array(s.lazy(() => roomEventSchema)),
    next: s.int(),
  });
