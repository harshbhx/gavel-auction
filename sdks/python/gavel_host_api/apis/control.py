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
from ..errors.control_auction_error import ControlAuctionErrorBody, control_auction_error_mapper
from ..errors.kill_auction_error import KillAuctionErrorBody, kill_auction_error_mapper
from ..models.api_auctions_kill_request import ApiAuctionsKillRequest, ApiAuctionsKillRequestDict
from ..models.api_auctions_kill_response import ApiAuctionsKillResponse
from ..models.control_request import ControlRequest, ControlRequestDict
from ..models.control_response import ControlResponse
from ..server.server import Server


class Control:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = ControlWithRawResponse(client, server, auth)

    def control_auction(
        self,
        id_: str,
        body: ControlRequest | ControlRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ControlResponse:
        """Auctioneer token only (a session or screen token authenticates but is refused with 403). Idempotent by
        ``controlId``: repeat the same id with the same action and you get the same answer. A ``hammer`` needs
        ``args.closeNow: 1`` while the lot is still open; it is refused with 409 when the price or leader changed since
        the console last looked.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The control was applied.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The request conflicts with the state of the lot or the credential: ``conflict`` (for
                example a hammer refused because the price or leader changed), ``closed``, ``invite_used``,
                ``lot_not_open``. The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.control_auction(id_, body, request_options=request_options))

    def kill_auction(
        self,
        id_: str,
        body: ApiAuctionsKillRequest | ApiAuctionsKillRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiAuctionsKillResponse:
        """Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold. A repeat, or a lot
        that is already over, is a no-op that answers 200 with the current state. The body must carry ``confirm:
        "STOP"``.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The lot is stopped.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.kill_auction(id_, body, request_options=request_options))

    @property
    def with_raw_response(self) -> ControlWithRawResponse:
        return self._with_raw_response


class AsyncControl:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncControlWithRawResponse(client, server, auth)

    async def control_auction(
        self,
        id_: str,
        body: ControlRequest | ControlRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ControlResponse:
        """Auctioneer token only (a session or screen token authenticates but is refused with 403). Idempotent by
        ``controlId``: repeat the same id with the same action and you get the same answer. A ``hammer`` needs
        ``args.closeNow: 1`` while the lot is still open; it is refused with 409 when the price or leader changed since
        the console last looked.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The control was applied.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The request conflicts with the state of the lot or the credential: ``conflict`` (for
                example a hammer refused because the price or leader changed), ``closed``, ``invite_used``,
                ``lot_not_open``. The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.control_auction(id_, body, request_options=request_options))

    async def kill_auction(
        self,
        id_: str,
        body: ApiAuctionsKillRequest | ApiAuctionsKillRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiAuctionsKillResponse:
        """Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold. A repeat, or a lot
        that is already over, is a no-op that answers 200 with the current state. The body must carry ``confirm:
        "STOP"``.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The lot is stopped.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.kill_auction(id_, body, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncControlWithRawResponse:
        return self._with_raw_response


class ControlWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def control_auction(
        self,
        id_: str,
        body: ControlRequest | ControlRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ControlResponse, ControlAuctionErrorBody]:
        """Auctioneer token only (a session or screen token authenticates but is refused with 403). Idempotent by
        ``controlId``: repeat the same id with the same action and you get the same answer. A ``hammer`` needs
        ``args.closeNow: 1`` while the lot is still open; it is refused with 409 when the price or leader changed since
        the console last looked.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/control"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ControlRequest | ControlRequestDict](body),
            auth_scheme=self._auth.auctioneer_auth,
            decoder=json_decoder[ControlResponse],
            error_mapper=control_auction_error_mapper,
            request_options=request_options,
        )

    def kill_auction(
        self,
        id_: str,
        body: ApiAuctionsKillRequest | ApiAuctionsKillRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiAuctionsKillResponse, KillAuctionErrorBody]:
        """Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold. A repeat, or a lot
        that is already over, is a no-op that answers 200 with the current state. The body must carry ``confirm:
        "STOP"``.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/kill"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsKillRequest | ApiAuctionsKillRequestDict](body),
            auth_scheme=self._auth.auctioneer_auth,
            decoder=json_decoder[ApiAuctionsKillResponse],
            error_mapper=kill_auction_error_mapper,
            request_options=request_options,
        )


class AsyncControlWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def control_auction(
        self,
        id_: str,
        body: ControlRequest | ControlRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ControlResponse, ControlAuctionErrorBody]:
        """Auctioneer token only (a session or screen token authenticates but is refused with 403). Idempotent by
        ``controlId``: repeat the same id with the same action and you get the same answer. A ``hammer`` needs
        ``args.closeNow: 1`` while the lot is still open; it is refused with 409 when the price or leader changed since
        the console last looked.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/control"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ControlRequest | ControlRequestDict](body),
            auth_scheme=self._auth.auctioneer_auth,
            decoder=async_json_decoder[ControlResponse],
            error_mapper=control_auction_error_mapper,
            request_options=request_options,
        )

    async def kill_auction(
        self,
        id_: str,
        body: ApiAuctionsKillRequest | ApiAuctionsKillRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiAuctionsKillResponse, KillAuctionErrorBody]:
        """Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold. A repeat, or a lot
        that is already over, is a no-op that answers 200 with the current state. The body must carry ``confirm:
        "STOP"``.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/kill"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsKillRequest | ApiAuctionsKillRequestDict](body),
            auth_scheme=self._auth.auctioneer_auth,
            decoder=async_json_decoder[ApiAuctionsKillResponse],
            error_mapper=kill_auction_error_mapper,
            request_options=request_options,
        )
