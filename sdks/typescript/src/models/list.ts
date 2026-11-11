import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const List = {
  _1: "1",
} as const;
export type List = (typeof List)[keyof typeof List] | (string & {});

export const listSchema: EnumSchema<List> = s.enumOf<List>(List);
