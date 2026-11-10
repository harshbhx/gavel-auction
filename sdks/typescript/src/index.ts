export { GavelHostApiClient } from "./client.js";
export type { ClientOptions } from "./client-options.js";

export type { TokenProvider } from "./core/auth/credentials.js";

export { ServerEnvironment } from "./servers.js";

export { Auctions } from "./resources/auctions.js";
export { BiddingAccess } from "./resources/bidding-access.js";
export { Control } from "./resources/control.js";
export { Read } from "./resources/read.js";
export { Holds } from "./resources/holds.js";
export { JudgeRooms } from "./resources/judge-rooms.js";
export { Export } from "./resources/export.js";
export { Operator } from "./resources/operator.js";
export { Receipts } from "./resources/receipts.js";
export { Health } from "./resources/health.js";

export { Action, actionSchema } from "./models/action.js";
export {
  apiAuctionsAuctioneerRevokeRequestSchema,
  type ApiAuctionsAuctioneerRevokeRequest,
} from "./models/api-auctions-auctioneer-revoke-request.js";
export {
  apiAuctionsAuctioneerRotateResponseSchema,
  type ApiAuctionsAuctioneerRotateResponse,
} from "./models/api-auctions-auctioneer-rotate-response.js";
export {
  apiAuctionsEventsResponseSchema,
  type ApiAuctionsEventsResponse,
} from "./models/api-auctions-events-response.js";
export {
  apiAuctionsInvitesRequestSchema,
  type ApiAuctionsInvitesRequest,
} from "./models/api-auctions-invites-request.js";
export {
  apiAuctionsInvitesResponseSchema,
  type ApiAuctionsInvitesResponse,
} from "./models/api-auctions-invites-response.js";
export {
  apiAuctionsJoinRequestSchema,
  type ApiAuctionsJoinRequest,
} from "./models/api-auctions-join-request.js";
export {
  apiAuctionsKillRequestSchema,
  type ApiAuctionsKillRequest,
} from "./models/api-auctions-kill-request.js";
export {
  apiAuctionsKillResponseSchema,
  type ApiAuctionsKillResponse,
} from "./models/api-auctions-kill-response.js";
export {
  apiAuctionsReceiptLinkResponseSchema,
  type ApiAuctionsReceiptLinkResponse,
} from "./models/api-auctions-receipt-link-response.js";
export {
  apiAuctionsReceiptResponseSchema,
  type ApiAuctionsReceiptResponse,
} from "./models/api-auctions-receipt-response.js";
export {
  apiHoldsApproveRequestSchema,
  type ApiHoldsApproveRequest,
} from "./models/api-holds-approve-request.js";
export {
  apiHoldsApproveResponseSchema,
  type ApiHoldsApproveResponse,
} from "./models/api-holds-approve-response.js";
export { apiHoldsRequestSchema, type ApiHoldsRequest } from "./models/api-holds-request.js";
export { apiHoldsResponseSchema, type ApiHoldsResponse } from "./models/api-holds-response.js";
export { apiHoldsResponse1Schema, type ApiHoldsResponse1 } from "./models/api-holds-response1.js";
export {
  apiJudgeCapabilitiesResponseSchema,
  type ApiJudgeCapabilitiesResponse,
} from "./models/api-judge-capabilities-response.js";
export { apiJudgeJoinRequestSchema, type ApiJudgeJoinRequest } from "./models/api-judge-join-request.js";
export { apiJudgeJoinResponseSchema, type ApiJudgeJoinResponse } from "./models/api-judge-join-response.js";
export { apiJudgeKeyResponseSchema, type ApiJudgeKeyResponse } from "./models/api-judge-key-response.js";
export { apiJudgeKeysResponseSchema, type ApiJudgeKeysResponse } from "./models/api-judge-keys-response.js";
export {
  apiJudgeKeysRevokeResponseSchema,
  type ApiJudgeKeysRevokeResponse,
} from "./models/api-judge-keys-revoke-response.js";
export { apiJudgePauseRequestSchema, type ApiJudgePauseRequest } from "./models/api-judge-pause-request.js";
export {
  apiJudgePauseResponseSchema,
  type ApiJudgePauseResponse,
} from "./models/api-judge-pause-response.js";
export {
  apiJudgeRoomsBids409ErrorSchema,
  type ApiJudgeRoomsBids409Error,
} from "./models/api-judge-rooms-bids409-error.js";
export {
  apiJudgeRoomsBidsRequestSchema,
  type ApiJudgeRoomsBidsRequest,
} from "./models/api-judge-rooms-bids-request.js";
export {
  apiJudgeRoomsBidsResponseSchema,
  type ApiJudgeRoomsBidsResponse,
} from "./models/api-judge-rooms-bids-response.js";
export {
  apiJudgeRoomsBidsResponse1Schema,
  type ApiJudgeRoomsBidsResponse1,
} from "./models/api-judge-rooms-bids-response1.js";
export {
  apiJudgeRoomsBidsResponse2Schema,
  type ApiJudgeRoomsBidsResponse2,
} from "./models/api-judge-rooms-bids-response2.js";
export {
  apiJudgeRoomsBidsResponse21Schema,
  type ApiJudgeRoomsBidsResponse21,
} from "./models/unions/api-judge-rooms-bids-response21.js";
export { apiJudgeRoomsRequestSchema, type ApiJudgeRoomsRequest } from "./models/api-judge-rooms-request.js";
export {
  apiJudgeRoomsSimHoldRequestSchema,
  type ApiJudgeRoomsSimHoldRequest,
} from "./models/api-judge-rooms-sim-hold-request.js";
export {
  apiJudgeRoomsSimHoldResponseSchema,
  type ApiJudgeRoomsSimHoldResponse,
} from "./models/api-judge-rooms-sim-hold-response.js";
export { auctionConfigSchema, type AuctionConfig } from "./models/auction-config.js";
export { auctionPublicSchema, type AuctionPublic } from "./models/auction-public.js";
export { AuctionStatus, auctionStatusSchema } from "./models/auction-status.js";
export { controlRequestSchema, type ControlRequest } from "./models/control-request.js";
export { controlResponseSchema, type ControlResponse } from "./models/control-response.js";
export { createAuctionRequestSchema, type CreateAuctionRequest } from "./models/create-auction-request.js";
export { createAuctionResponseSchema, type CreateAuctionResponse } from "./models/create-auction-response.js";
export { createHoldResponseSchema, type CreateHoldResponse } from "./models/create-hold-response.js";
export { errorSchema, type Error } from "./models/error.js";
export { error1Schema, type Error1 } from "./models/error1.js";
export { error2Schema, type Error2 } from "./models/error2.js";
export { error3Schema, type Error3 } from "./models/error3.js";
export { Error4, error4Schema } from "./models/error4.js";
export { error5Schema, type Error5 } from "./models/unions/error5.js";
export { ErrorCode, errorCodeSchema } from "./models/error-code.js";
export { fundraiserSchema, type Fundraiser } from "./models/fundraiser.js";
export { hammerSchema, type Hammer } from "./models/hammer.js";
export { Hold, holdSchema } from "./models/hold.js";
export { HoldErrorCode, holdErrorCodeSchema } from "./models/hold-error-code.js";
export { HoldScope, holdScopeSchema } from "./models/hold-scope.js";
export { HoldStatus, holdStatusSchema } from "./models/hold-status.js";
export { incrementLadderSchema, type IncrementLadder } from "./models/increment-ladder.js";
export { inviteSchema, type Invite } from "./models/invite.js";
export { joinResponseSchema, type JoinResponse } from "./models/join-response.js";
export { judgeRoomSchema, type JudgeRoom } from "./models/judge-room.js";
export { keySchema, type Key } from "./models/key.js";
export { Mode, modeSchema } from "./models/mode.js";
export {
  opsAuctionsReleaseReviewResponseSchema,
  type OpsAuctionsReleaseReviewResponse,
} from "./models/ops-auctions-release-review-response.js";
export {
  opsAuctionsVoidAllResponseSchema,
  type OpsAuctionsVoidAllResponse,
} from "./models/ops-auctions-void-all-response.js";
export { opsRoomsResponseSchema, type OpsRoomsResponse } from "./models/ops-rooms-response.js";
export { opsSummaryResponseSchema, type OpsSummaryResponse } from "./models/ops-summary-response.js";
export { readyz503ErrorSchema, type Readyz503Error } from "./models/readyz503-error.js";
export { readyz503Error1Schema, type Readyz503Error1 } from "./models/readyz503-error1.js";
export { Reason, reasonSchema } from "./models/reason.js";
export { replayBundleSchema, type ReplayBundle } from "./models/replay-bundle.js";
export { revokedSchema, type Revoked } from "./models/revoked.js";
export { roomSchema, type Room } from "./models/room.js";
export { roomEventSchema, type RoomEvent } from "./models/room-event.js";
export { roomSnapshotSchema, type RoomSnapshot } from "./models/room-snapshot.js";
export { rosterSchema, type Roster } from "./models/roster.js";
export { sagaSchema, type Saga } from "./models/saga.js";
export { stateSchema, type State } from "./models/state.js";
export { stateFrameSchema, type StateFrame } from "./models/state-frame.js";
export { statusSchema, type Status } from "./models/status.js";
export { stepSchema, type Step } from "./models/step.js";
export { versionResponseSchema, type VersionResponse } from "./models/version-response.js";
export { warmupReportSchema, type WarmupReport } from "./models/warmup-report.js";
export { warmupReportErrorSchema, type WarmupReportError } from "./models/warmup-report-error.js";
export { Kind, kindSchema } from "./models/kind.js";
export { List, listSchema } from "./models/list.js";

export {
  CoreError as GavelHostApiError,
  ResponseError,
  DecodeError,
  EncodeError,
  ConnectionError,
  TimeoutError,
  AuthError,
  PaginationError,
  ConfigurationError,
} from "./core/errors.js";
export { ApiError } from "./core/api-error.js";
export { SchemaError } from "./core/validation/schema-error.js";
export {
  defaultLoggingOptions,
  type LoggingOptions,
  type RequestLoggingOptions,
  type Logger,
  type LogDetails,
  type HttpRequestDetails,
  type RequestHeadersDetails,
  type RequestBodyDetails,
  type HttpResponseDetails,
  type ResponseHeadersDetails,
  type HttpRetryingDetails,
  type HttpFailedDetails,
  type LogLevel,
} from "./core/logging.js";
export type { ApiPromise, ApiResult } from "./core/api-promise.js";
export type { Pageable, PageableApiResult } from "./core/pagination/pageable.js";
export type { HttpMethod, RequestOptions } from "./core/api-request.js";
export type { RetryOptions, RequestRetryOptions, RetryAttempt, RetryReason } from "./core/retry.js";
export type { BinaryContent, BinaryData, BinaryErrorContent, FileData, FileInput } from "./core/binary.js";
export type { ErrorKind } from "./core/errors.js";
export type { Declared, Undeclared } from "./core/api-error.js";
export type { Schema, EnumSchema, Encoded } from "./core/validation/schema.js";
