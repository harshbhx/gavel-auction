from __future__ import annotations

from uuid import UUID, uuid4

from ..auth import AsyncAuthSchemes, AuthSchemes
from ..core import (
    ApiResult,
    AsyncRawClient,
    RawClient,
    RequestOptionsOrDict,
    SecuredRawResponse,
    async_json_decoder,
    json_body,
    json_decoder,
    param,
    unwrap,
)
from ..errors.create_invites_error import CreateInvitesErrorBody, create_invites_error_mapper
from ..errors.join_auction_error import JoinAuctionErrorBody, join_auction_error_mapper
from ..errors.reissue_invite_error import ReissueInviteErrorBody, reissue_invite_error_mapper
from ..models.api_auctions_invites_request import ApiAuctionsInvitesRequest, ApiAuctionsInvitesRequestDict
from ..models.api_auctions_invites_response import ApiAuctionsInvitesResponse
from ..models.api_auctions_join_request import ApiAuctionsJoinRequest, ApiAuctionsJoinRequestDict
from ..models.invite import Invite
from ..models.join_response import JoinResponse
from ..server.server import Server


class BiddingAccess:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = BiddingAccessWithRawResponse(client, server, auth)

    def create_invites(
        self,
        id_: str,
        *,
        body: ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiAuctionsInvitesResponse:
        """Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new bidder id. Between 1 and
        50 per call.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Invites minted.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.create_invites(id_, body=body, request_options=request_options))

    def join_auction(
        self,
        id_: str,
        body: ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> JoinResponse:
        """No header credential: the invite token goes in the body. ``id`` may be the auction id or its join code. The
        invite is burned on use; a second use answers 409 ``invite_used``. Returns the session token for bidding and the
        WebSocket address.

        Args:
            id_: Auction id, or its 6 character join code.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Session created.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. No such auction,
                bidder, room or route (``not_found``). The request conflicts with the state of the lot or the
                credential: ``conflict`` (for example a hammer refused because the price or leader changed), ``closed``,
                ``invite_used``, ``lot_not_open``. The body is larger than 64 KiB (``bad_message``). A body was sent
                that is not ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.join_auction(id_, body, request_options=request_options))

    def reissue_invite(
        self, id_: str, bidder_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> Invite:
        """Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for the same bidder id, so
        their hold and bids stay theirs. Answers 404 for a bidder who has no hold in the room.

        Args:
            id_: Auction id.
            bidder_id: Id of the registered bidder to re-invite.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            New invite.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.reissue_invite(id_, bidder_id, request_options=request_options))

    @property
    def with_raw_response(self) -> BiddingAccessWithRawResponse:
        return self._with_raw_response


class AsyncBiddingAccess:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncBiddingAccessWithRawResponse(client, server, auth)

    async def create_invites(
        self,
        id_: str,
        *,
        body: ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiAuctionsInvitesResponse:
        """Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new bidder id. Between 1 and
        50 per call.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Invites minted.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.create_invites(id_, body=body, request_options=request_options))

    async def join_auction(
        self,
        id_: str,
        body: ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> JoinResponse:
        """No header credential: the invite token goes in the body. ``id`` may be the auction id or its join code. The
        invite is burned on use; a second use answers 409 ``invite_used``. Returns the session token for bidding and the
        WebSocket address.

        Args:
            id_: Auction id, or its 6 character join code.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Session created.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. No such auction,
                bidder, room or route (``not_found``). The request conflicts with the state of the lot or the
                credential: ``conflict`` (for example a hammer refused because the price or leader changed), ``closed``,
                ``invite_used``, ``lot_not_open``. The body is larger than 64 KiB (``bad_message``). A body was sent
                that is not ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.join_auction(id_, body, request_options=request_options))

    async def reissue_invite(
        self, id_: str, bidder_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> Invite:
        """Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for the same bidder id, so
        their hold and bids stay theirs. Answers 404 for a bidder who has no hold in the room.

        Args:
            id_: Auction id.
            bidder_id: Id of the registered bidder to re-invite.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            New invite.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.reissue_invite(id_, bidder_id, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncBiddingAccessWithRawResponse:
        return self._with_raw_response


class BiddingAccessWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def create_invites(
        self,
        id_: str,
        *,
        body: ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiAuctionsInvitesResponse, CreateInvitesErrorBody]:
        """Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new bidder id. Between 1 and
        50 per call.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/invites"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None](body),
            auth_scheme=self._auth.auctioneer_auth,
            decoder=json_decoder[ApiAuctionsInvitesResponse],
            error_mapper=create_invites_error_mapper,
            request_options=request_options,
        )

    def join_auction(
        self,
        id_: str,
        body: ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[JoinResponse, JoinAuctionErrorBody]:
        """No header credential: the invite token goes in the body. ``id`` may be the auction id or its join code. The
        invite is burned on use; a second use answers 409 ``invite_used``. Returns the session token for bidding and the
        WebSocket address.

        Args:
            id_: Auction id, or its 6 character join code.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/join"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict](body),
            decoder=json_decoder[JoinResponse],
            error_mapper=join_auction_error_mapper,
            request_options=request_options,
        )

    def reissue_invite(
        self, id_: str, bidder_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Invite, ReissueInviteErrorBody]:
        """Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for the same bidder id, so
        their hold and bids stay theirs. Answers 404 for a bidder who has no hold in the room.

        Args:
            id_: Auction id.
            bidder_id: Id of the registered bidder to re-invite.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/bidders/{bidderId}/invite"),
            path_params=[param[str]("id", id_), param[str]("bidderId", bidder_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.auctioneer_auth,
            decoder=json_decoder[Invite],
            error_mapper=reissue_invite_error_mapper,
            request_options=request_options,
        )


class AsyncBiddingAccessWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def create_invites(
        self,
        id_: str,
        *,
        body: ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiAuctionsInvitesResponse, CreateInvitesErrorBody]:
        """Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new bidder id. Between 1 and
        50 per call.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/invites"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None](body),
            auth_scheme=self._auth.auctioneer_auth,
            decoder=async_json_decoder[ApiAuctionsInvitesResponse],
            error_mapper=create_invites_error_mapper,
            request_options=request_options,
        )

    async def join_auction(
        self,
        id_: str,
        body: ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[JoinResponse, JoinAuctionErrorBody]:
        """No header credential: the invite token goes in the body. ``id`` may be the auction id or its join code. The
        invite is burned on use; a second use answers 409 ``invite_used``. Returns the session token for bidding and the
        WebSocket address.

        Args:
            id_: Auction id, or its 6 character join code.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/join"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict](body),
            decoder=async_json_decoder[JoinResponse],
            error_mapper=join_auction_error_mapper,
            request_options=request_options,
        )

    async def reissue_invite(
        self, id_: str, bidder_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Invite, ReissueInviteErrorBody]:
        """Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for the same bidder id, so
        their hold and bids stay theirs. Answers 404 for a bidder who has no hold in the room.

        Args:
            id_: Auction id.
            bidder_id: Id of the registered bidder to re-invite.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/bidders/{bidderId}/invite"),
            path_params=[param[str]("id", id_), param[str]("bidderId", bidder_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.auctioneer_auth,
            decoder=async_json_decoder[Invite],
            error_mapper=reissue_invite_error_mapper,
            request_options=request_options,
        )
