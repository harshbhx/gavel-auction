<!-- Generated file — do not edit; regenerated with the SDK. -->

# BiddingAccess — operations

Accessor: `client.biddingAccess` · Source: `src/resources/bidding-access.ts` · 3 operations · Request and error types: namespace `BiddingAccess`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### createInvites

- **Signature**: `createInvites(request: BiddingAccess.CreateInvitesRequest, options?: RequestOptions): ApiPromise<ApiAuctionsInvitesResponse, BiddingAccess.CreateInvitesError>`
- **Wire**: `POST /api/auctions/{id}/invites`
- **Auth**: `auctioneerAuth`
- **Request body**: `application/json` — the `body` field. **Optional**: omit it and the request carries no body and no `Content-Type` header at all
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiAuctionsInvitesResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `BiddingAccess.CreateInvitesError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [403] `Error5` · `"error54"` [404] `Error5` · `"error55"` [413] `Error5` · `"error56"` [415] `Error5` · `"error57"` [429] `Error5` · `"error58"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `BiddingAccess.CreateInvitesRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ApiAuctionsInvitesRequest` | no |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsInvitesRequest` | `apiAuctionsInvitesRequestSchema` | `src/models/api-auctions-invites-request.ts` |
| `ApiAuctionsInvitesResponse` | `apiAuctionsInvitesResponseSchema` | `src/models/api-auctions-invites-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### joinAuction

- **Signature**: `joinAuction(request: BiddingAccess.JoinAuctionRequest, options?: RequestOptions): ApiPromise<JoinResponse, BiddingAccess.JoinAuctionError>`
- **Wire**: `POST /api/auctions/{id}/join`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `JoinResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `BiddingAccess.JoinAuctionError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [409] `Error5` · `"error55"` [413] `Error5` · `"error56"` [415] `Error5` · `"error57"` [429] `Error5` · `"error58"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `BiddingAccess.JoinAuctionRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ApiAuctionsJoinRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsJoinRequest` | `apiAuctionsJoinRequestSchema` | `src/models/api-auctions-join-request.ts` |
| `JoinResponse` | `joinResponseSchema` | `src/models/join-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### reissueInvite

- **Signature**: `reissueInvite(request: BiddingAccess.ReissueInviteRequest, options?: RequestOptions): ApiPromise<Invite, BiddingAccess.ReissueInviteError>`
- **Wire**: `POST /api/auctions/{id}/bidders/{bidderId}/invite`
- **Auth**: `auctioneerAuth`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `Invite`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `BiddingAccess.ReissueInviteError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [403] `Error5` · `"error53"` [404] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `BiddingAccess.ReissueInviteRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `bidderId` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Invite` | `inviteSchema` | `src/models/invite.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

