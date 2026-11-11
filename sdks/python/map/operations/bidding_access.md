<!-- Generated file — do not edit; regenerated with the SDK. -->

# BiddingAccess — operations

Accessor: `client.bidding_access` · Source: `gavel_host_api/apis/bidding_access.py` · 3 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.bidding_access.create_invites

- **Route**: `POST /api/auctions/{id}/invites`
- **Auth**: `auctioneer_auth`
- **Signature**: `def create_invites(id_: str, *, body: ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None = None, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `ApiAuctionsInvitesResponse`
- **Returns (raw)**: `ApiResult[ApiAuctionsInvitesResponse, CreateInvitesErrorBody]`
- **Error**: `CreateInvitesErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 403, 404, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsInvitesRequest` | `gavel_host_api/models/api_auctions_invites_request.py` |
| `ApiAuctionsInvitesRequestDict` | `gavel_host_api/models/api_auctions_invites_request.py` |
| `ApiAuctionsInvitesResponse` | `gavel_host_api/models/api_auctions_invites_response.py` |
| `CreateInvitesErrorBody` | `gavel_host_api/errors/create_invites_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.bidding_access.join_auction

- **Route**: `POST /api/auctions/{id}/join`
- **Signature**: `def join_auction(id_: str, body: ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `body`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `JoinResponse`
- **Returns (raw)**: `ApiResult[JoinResponse, JoinAuctionErrorBody]`
- **Error**: `JoinAuctionErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 409, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsJoinRequest` | `gavel_host_api/models/api_auctions_join_request.py` |
| `ApiAuctionsJoinRequestDict` | `gavel_host_api/models/api_auctions_join_request.py` |
| `JoinResponse` | `gavel_host_api/models/join_response.py` |
| `JoinAuctionErrorBody` | `gavel_host_api/errors/join_auction_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.bidding_access.reissue_invite

- **Route**: `POST /api/auctions/{id}/bidders/{bidderId}/invite`
- **Auth**: `auctioneer_auth`
- **Signature**: `def reissue_invite(id_: str, bidder_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `bidder_id`
- **Params**: `id_` — path `id` · `bidder_id` — path `bidderId`
- **Returns (parsed)**: `Invite`
- **Returns (raw)**: `ApiResult[Invite, ReissueInviteErrorBody]`
- **Error**: `ReissueInviteErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 403, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `Invite` | `gavel_host_api/models/invite.py` |
| `ReissueInviteErrorBody` | `gavel_host_api/errors/reissue_invite_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

