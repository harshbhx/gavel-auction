import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type VersionResponse = {
  sha: string;
};

export const versionResponseSchema: Schema<VersionResponse> = s.object<VersionResponse>({
  sha: s.string(),
});
