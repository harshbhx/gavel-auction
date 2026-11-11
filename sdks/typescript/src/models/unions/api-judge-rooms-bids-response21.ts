import * as s from "../../core/validation/index.js";
import type { Schema } from "../../core/validation/schema.js";
import {
  apiJudgeRoomsBidsResponse2Schema,
  type ApiJudgeRoomsBidsResponse2,
} from "../api-judge-rooms-bids-response2.js";
import { error5Schema, type Error5 } from "./error5.js";

export type ApiJudgeRoomsBidsResponse21 = ApiJudgeRoomsBidsResponse2 | Error5;

export const apiJudgeRoomsBidsResponse21Schema: Schema<ApiJudgeRoomsBidsResponse21> =
  s.of<ApiJudgeRoomsBidsResponse21>(
    s.union([s.lazy(() => apiJudgeRoomsBidsResponse2Schema), s.lazy(() => error5Schema)]),
  );
