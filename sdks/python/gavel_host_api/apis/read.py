from __future__ import annotations

from ..auth import AsyncAuthSchemes, AuthSchemes
from ..core import (
    AnySchemes,
    ApiResult,
    AsyncAnySchemes,
    AsyncRawClient,
    RawClient,
    RequestOptionsOrDict,
    SecuredRawResponse,
    async_json_decoder,
    json_decoder,
    param,
    unwrap,
)
from ..errors.get_snapshot_error import GetSnapshotErrorBody, get_snapshot_error_mapper
from ..errors.list_events_error import ListEventsErrorBody, list_events_error_mapper
from ..models.api_auctions_events_response import ApiAuctionsEventsResponse
from ..models.state_frame import StateFrame
from ..server.server import Server


class Read:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = ReadWithRawResponse(client, server, auth)

    def get_snapshot(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> StateFrame:
        """The same snapshot the WebSocket sends in a ``state`` frame, filtered by role: a bidder sees only their own
        ceiling and hold, a screen sees no private fields, the auctioneer sees the full audit rows. A reviewer token
        gets the screen's view.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The state frame.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_snapshot(id_, request_options=request_options))

    def list_events(
        self,
        id_: str,
        *,
        after: int | None = 0,
        limit: int | None = 100,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiAuctionsEventsResponse:
        """Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after sequence ``after``,
        at most ``limit``. A screen sees full rows only for public event types; every other event is a bare ``{seq}`` so
        the log stays whole. Ceilings, transcripts, hold references and the auctioneer subject are never returned. Pass
        ``next`` back as ``after`` to continue.

        Args:
            id_: Auction id.
            after: Return events after this sequence number. Pass the ``next`` of the previous page to continue.
            limit: Most events to return in one page.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            A page of events.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. No such auction,
                bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(
            self._with_raw_response.list_events(id_, after=after, limit=limit, request_options=request_options)
        )

    @property
    def with_raw_response(self) -> ReadWithRawResponse:
        return self._with_raw_response


class AsyncRead:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncReadWithRawResponse(client, server, auth)

    async def get_snapshot(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> StateFrame:
        """The same snapshot the WebSocket sends in a ``state`` frame, filtered by role: a bidder sees only their own
        ceiling and hold, a screen sees no private fields, the auctioneer sees the full audit rows. A reviewer token
        gets the screen's view.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The state frame.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_snapshot(id_, request_options=request_options))

    async def list_events(
        self,
        id_: str,
        *,
        after: int | None = 0,
        limit: int | None = 100,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiAuctionsEventsResponse:
        """Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after sequence ``after``,
        at most ``limit``. A screen sees full rows only for public event types; every other event is a bare ``{seq}`` so
        the log stays whole. Ceilings, transcripts, hold references and the auctioneer subject are never returned. Pass
        ``next`` back as ``after`` to continue.

        Args:
            id_: Auction id.
            after: Return events after this sequence number. Pass the ``next`` of the previous page to continue.
            limit: Most events to return in one page.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            A page of events.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. No such auction,
                bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(
            await self._with_raw_response.list_events(id_, after=after, limit=limit, request_options=request_options)
        )

    @property
    def with_raw_response(self) -> AsyncReadWithRawResponse:
        return self._with_raw_response


class ReadWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def get_snapshot(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[StateFrame, GetSnapshotErrorBody]:
        """The same snapshot the WebSocket sends in a ``state`` frame, filtered by role: a bidder sees only their own
        ceiling and hold, a screen sees no private fields, the auctioneer sees the full audit rows. A reviewer token
        gets the screen's view.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/snapshot"),
            path_params=[param[str]("id", id_)],
            auth_scheme=AnySchemes(
                self._auth.auctioneer_auth, self._auth.screen_auth, self._auth.session_auth, self._auth.reviewer_auth
            ),
            decoder=json_decoder[StateFrame],
            error_mapper=get_snapshot_error_mapper,
            request_options=request_options,
        )

    def list_events(
        self,
        id_: str,
        *,
        after: int | None = 0,
        limit: int | None = 100,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiAuctionsEventsResponse, ListEventsErrorBody]:
        """Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after sequence ``after``,
        at most ``limit``. A screen sees full rows only for public event types; every other event is a bare ``{seq}`` so
        the log stays whole. Ceilings, transcripts, hold references and the auctioneer subject are never returned. Pass
        ``next`` back as ``after`` to continue.

        Args:
            id_: Auction id.
            after: Return events after this sequence number. Pass the ``next`` of the previous page to continue.
            limit: Most events to return in one page.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/events"),
            path_params=[param[str]("id", id_)],
            query_params=[param[int | None]("after", after), param[int | None]("limit", limit)],
            auth_scheme=AnySchemes(self._auth.auctioneer_auth, self._auth.screen_auth, self._auth.reviewer_auth),
            decoder=json_decoder[ApiAuctionsEventsResponse],
            error_mapper=list_events_error_mapper,
            request_options=request_options,
        )


class AsyncReadWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def get_snapshot(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[StateFrame, GetSnapshotErrorBody]:
        """The same snapshot the WebSocket sends in a ``state`` frame, filtered by role: a bidder sees only their own
        ceiling and hold, a screen sees no private fields, the auctioneer sees the full audit rows. A reviewer token
        gets the screen's view.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/snapshot"),
            path_params=[param[str]("id", id_)],
            auth_scheme=AsyncAnySchemes(
                self._auth.auctioneer_auth, self._auth.screen_auth, self._auth.session_auth, self._auth.reviewer_auth
            ),
            decoder=async_json_decoder[StateFrame],
            error_mapper=get_snapshot_error_mapper,
            request_options=request_options,
        )

    async def list_events(
        self,
        id_: str,
        *,
        after: int | None = 0,
        limit: int | None = 100,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiAuctionsEventsResponse, ListEventsErrorBody]:
        """Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after sequence ``after``,
        at most ``limit``. A screen sees full rows only for public event types; every other event is a bare ``{seq}`` so
        the log stays whole. Ceilings, transcripts, hold references and the auctioneer subject are never returned. Pass
        ``next`` back as ``after`` to continue.

        Args:
            id_: Auction id.
            after: Return events after this sequence number. Pass the ``next`` of the previous page to continue.
            limit: Most events to return in one page.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/events"),
            path_params=[param[str]("id", id_)],
            query_params=[param[int | None]("after", after), param[int | None]("limit", limit)],
            auth_scheme=AsyncAnySchemes(self._auth.auctioneer_auth, self._auth.screen_auth, self._auth.reviewer_auth),
            decoder=async_json_decoder[ApiAuctionsEventsResponse],
            error_mapper=list_events_error_mapper,
            request_options=request_options,
        )
