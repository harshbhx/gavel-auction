import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { inviteSchema, type Invite } from "./invite.js";

export type ApiAuctionsInvitesResponse = {
  invites: Invite[];
};

export const apiAuctionsInvitesResponseSchema: Schema<ApiAuctionsInvitesResponse> =
  s.object<ApiAuctionsInvitesResponse>({
    invites: s.array(s.lazy(() => inviteSchema)),
  });
