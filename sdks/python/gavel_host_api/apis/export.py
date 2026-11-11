from __future__ import annotations

from typing import Any

from ..auth import AsyncAuthSchemes, AuthSchemes
from ..core import (
    AnySchemes,
    ApiResult,
    AsyncAnySchemes,
    AsyncRawClient,
    RawClient,
    RequestOptionsOrDict,
    SecuredRawResponse,
    async_empty_response,
    async_json_decoder,
    empty_response,
    json_decoder,
    param,
    unwrap,
)
from ..errors.admin_export_error import AdminExportErrorBody, admin_export_error_mapper
from ..errors.admin_replay_bundle_error import AdminReplayBundleErrorBody, admin_replay_bundle_error_mapper
from ..errors.export_events_error import ExportEventsErrorBody, export_events_error_mapper
from ..errors.get_judge_room_ledger_error import GetJudgeRoomLedgerErrorBody, get_judge_room_ledger_error_mapper
from ..models.enums.kind import KindOrStr
from ..models.enums.list import ListOrStr
from ..models.replay_bundle import ReplayBundle
from ..server.server import Server


class Export:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = ExportWithRawResponse(client, server, auth)

    def admin_export(
        self,
        *,
        auction: str | None = None,
        list_: ListOrStr | None = None,
        kind: KindOrStr | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> None:
        """Operator only. Output carries every bidder's ceiling, hold reference and bid transcript: never publish it.
        Modes by query: ``auction=<id>`` (the hash-chained ledger as NDJSON, last line ``{head}``); ``list=1`` (all
        auction ids); ``kind=payments&auction=<id>`` (settlement journal and holds); ``kind=payments-global`` (webhook
        event ids and kill switch); ``kind=roomlog&auction=<id>`` (room events as NDJSON, last line ``{end}``).
        Secret-looking keys are replaced with ``[redacted]`` and webhook bodies are dropped. Errors are ``{"error":
        "<code>"}``.

        Args:
            auction: Auction id (``auctionId`` is accepted as an alias).
            list_: Send ``1`` to list every auction id instead of exporting one auction.
            kind: Which export to return. Without it, ``auction`` returns the ledger.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            JSON or NDJSON depending on the mode.

        Raises:
            ApiError: A bad query on an operator route (``bad_auction_id``, ``bad_kind``). The credential is missing,
                expired, revoked, of the wrong kind or for another auction. No such auction, bidder, room or route
                (``not_found``). Wrong method for a route the host serves directly. The ``Allow`` header names the right
                one. Too many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``),
                a full judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After``
                seconds. Something failed on the host (``internal``). The message never carries internals. The host does
                not support this export mode. ``error`` is ``Error5 | RawError``."""
        return unwrap(
            self._with_raw_response.admin_export(
                auction=auction, list_=list_, kind=kind, request_options=request_options
            ),
        )

    def admin_replay_bundle(self, auction_id: str, *, request_options: RequestOptionsOrDict | None = None) -> Any:
        """Operator only. A self-contained bundle of the auction's ledger for replay and verification. Query
        ``auctionId`` is required. 409 when the hash chain is broken.

        Args:
            auction_id: Id of the auction to bundle.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The bundle (format defined in ``packages/shared/src/replay-bundle.ts``).

        Raises:
            ApiError: A bad query on an operator route (``bad_auction_id``, ``bad_kind``). The credential is missing,
                expired, revoked, of the wrong kind or for another auction. No such auction, bidder, room or route
                (``not_found``). Wrong method for a route the host serves directly. The ``Allow`` header names the right
                one. The request conflicts with the state of the lot or the credential: ``conflict`` (for example a
                hammer refused because the price or leader changed), ``closed``, ``invite_used``, ``lot_not_open``. Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(self._with_raw_response.admin_replay_bundle(auction_id, request_options=request_options))

    def export_events(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> None:
        """Auctioneer token or operator key. One JSON object per line, in sequence order, with personal fields removed
        for everyone but the operator. If the store has a gap the connection is cut instead of ending quietly, so a
        short file never looks complete. This route is served by the host directly: its errors are ``{"error":
        "<code>"}`` only.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            NDJSON stream.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Wrong method for a route the host serves directly. The ``Allow`` header names the right
                one. Too many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``),
                a full judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After``
                seconds. Something failed on the host (``internal``). The message never carries internals. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.export_events(id_, request_options=request_options))

    def get_judge_room_ledger(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ReplayBundle:
        """Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay bundle with the private
        fields removed. The private chain and the public chain are both checked before anything is sent: a broken chain
        answers 409 ``ledger_unverified`` instead of a bundle that looks fine. 404 before the ledger has any entry, for
        an id that is not a judge room, or when judge rooms are off.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The bundle.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). The ledger does not verify (``ledger_unverified``). Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(self._with_raw_response.get_judge_room_ledger(id_, request_options=request_options))

    @property
    def with_raw_response(self) -> ExportWithRawResponse:
        return self._with_raw_response


class AsyncExport:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncExportWithRawResponse(client, server, auth)

    async def admin_export(
        self,
        *,
        auction: str | None = None,
        list_: ListOrStr | None = None,
        kind: KindOrStr | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> None:
        """Operator only. Output carries every bidder's ceiling, hold reference and bid transcript: never publish it.
        Modes by query: ``auction=<id>`` (the hash-chained ledger as NDJSON, last line ``{head}``); ``list=1`` (all
        auction ids); ``kind=payments&auction=<id>`` (settlement journal and holds); ``kind=payments-global`` (webhook
        event ids and kill switch); ``kind=roomlog&auction=<id>`` (room events as NDJSON, last line ``{end}``).
        Secret-looking keys are replaced with ``[redacted]`` and webhook bodies are dropped. Errors are ``{"error":
        "<code>"}``.

        Args:
            auction: Auction id (``auctionId`` is accepted as an alias).
            list_: Send ``1`` to list every auction id instead of exporting one auction.
            kind: Which export to return. Without it, ``auction`` returns the ledger.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            JSON or NDJSON depending on the mode.

        Raises:
            ApiError: A bad query on an operator route (``bad_auction_id``, ``bad_kind``). The credential is missing,
                expired, revoked, of the wrong kind or for another auction. No such auction, bidder, room or route
                (``not_found``). Wrong method for a route the host serves directly. The ``Allow`` header names the right
                one. Too many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``),
                a full judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After``
                seconds. Something failed on the host (``internal``). The message never carries internals. The host does
                not support this export mode. ``error`` is ``Error5 | RawError``."""
        return unwrap(
            await self._with_raw_response.admin_export(
                auction=auction, list_=list_, kind=kind, request_options=request_options
            ),
        )

    async def admin_replay_bundle(self, auction_id: str, *, request_options: RequestOptionsOrDict | None = None) -> Any:
        """Operator only. A self-contained bundle of the auction's ledger for replay and verification. Query
        ``auctionId`` is required. 409 when the hash chain is broken.

        Args:
            auction_id: Id of the auction to bundle.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The bundle (format defined in ``packages/shared/src/replay-bundle.ts``).

        Raises:
            ApiError: A bad query on an operator route (``bad_auction_id``, ``bad_kind``). The credential is missing,
                expired, revoked, of the wrong kind or for another auction. No such auction, bidder, room or route
                (``not_found``). Wrong method for a route the host serves directly. The ``Allow`` header names the right
                one. The request conflicts with the state of the lot or the credential: ``conflict`` (for example a
                hammer refused because the price or leader changed), ``closed``, ``invite_used``, ``lot_not_open``. Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(await self._with_raw_response.admin_replay_bundle(auction_id, request_options=request_options))

    async def export_events(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> None:
        """Auctioneer token or operator key. One JSON object per line, in sequence order, with personal fields removed
        for everyone but the operator. If the store has a gap the connection is cut instead of ending quietly, so a
        short file never looks complete. This route is served by the host directly: its errors are ``{"error":
        "<code>"}`` only.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            NDJSON stream.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Wrong method for a route the host serves directly. The ``Allow`` header names the right
                one. Too many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``),
                a full judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After``
                seconds. Something failed on the host (``internal``). The message never carries internals. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.export_events(id_, request_options=request_options))

    async def get_judge_room_ledger(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ReplayBundle:
        """Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay bundle with the private
        fields removed. The private chain and the public chain are both checked before anything is sent: a broken chain
        answers 409 ``ledger_unverified`` instead of a bundle that looks fine. 404 before the ledger has any entry, for
        an id that is not a judge room, or when judge rooms are off.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The bundle.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). The ledger does not verify (``ledger_unverified``). Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(await self._with_raw_response.get_judge_room_ledger(id_, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncExportWithRawResponse:
        return self._with_raw_response


class ExportWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def admin_export(
        self,
        *,
        auction: str | None = None,
        list_: ListOrStr | None = None,
        kind: KindOrStr | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[None, AdminExportErrorBody]:
        """Operator only. Output carries every bidder's ceiling, hold reference and bid transcript: never publish it.
        Modes by query: ``auction=<id>`` (the hash-chained ledger as NDJSON, last line ``{head}``); ``list=1`` (all
        auction ids); ``kind=payments&auction=<id>`` (settlement journal and holds); ``kind=payments-global`` (webhook
        event ids and kill switch); ``kind=roomlog&auction=<id>`` (room events as NDJSON, last line ``{end}``).
        Secret-looking keys are replaced with ``[redacted]`` and webhook bodies are dropped. Errors are ``{"error":
        "<code>"}``.

        Args:
            auction: Auction id (``auctionId`` is accepted as an alias).
            list_: Send ``1`` to list every auction id instead of exporting one auction.
            kind: Which export to return. Without it, ``auction`` returns the ledger.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/admin/export"),
            query_params=[
                param[str | None]("auction", auction),
                param[ListOrStr | None]("list", list_),
                param[KindOrStr | None]("kind", kind),
            ],
            auth_scheme=self._auth.admin_key,
            decoder=empty_response,
            error_mapper=admin_export_error_mapper,
            request_options=request_options,
        )

    def admin_replay_bundle(
        self, auction_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Any, AdminReplayBundleErrorBody]:
        """Operator only. A self-contained bundle of the auction's ledger for replay and verification. Query
        ``auctionId`` is required. 409 when the hash chain is broken.

        Args:
            auction_id: Id of the auction to bundle.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/admin/replay-bundle"),
            query_params=[param[str]("auctionId", auction_id)],
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[Any],
            error_mapper=admin_replay_bundle_error_mapper,
            request_options=request_options,
        )

    def export_events(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[None, ExportEventsErrorBody]:
        """Auctioneer token or operator key. One JSON object per line, in sequence order, with personal fields removed
        for everyone but the operator. If the store has a gap the connection is cut instead of ending quietly, so a
        short file never looks complete. This route is served by the host directly: its errors are ``{"error":
        "<code>"}`` only.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/export"),
            path_params=[param[str]("id", id_)],
            auth_scheme=AnySchemes(self._auth.auctioneer_auth, self._auth.admin_key),
            decoder=empty_response,
            error_mapper=export_events_error_mapper,
            request_options=request_options,
        )

    def get_judge_room_ledger(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ReplayBundle, GetJudgeRoomLedgerErrorBody]:
        """Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay bundle with the private
        fields removed. The private chain and the public chain are both checked before anything is sent: a broken chain
        answers 409 ``ledger_unverified`` instead of a bundle that looks fine. 404 before the ledger has any entry, for
        an id that is not a judge room, or when judge rooms are off.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/judge/rooms/{id}/ledger"),
            path_params=[param[str]("id", id_)],
            auth_scheme=AnySchemes(self._auth.reviewer_auth, self._auth.auctioneer_auth),
            decoder=json_decoder[ReplayBundle],
            error_mapper=get_judge_room_ledger_error_mapper,
            request_options=request_options,
        )


class AsyncExportWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def admin_export(
        self,
        *,
        auction: str | None = None,
        list_: ListOrStr | None = None,
        kind: KindOrStr | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[None, AdminExportErrorBody]:
        """Operator only. Output carries every bidder's ceiling, hold reference and bid transcript: never publish it.
        Modes by query: ``auction=<id>`` (the hash-chained ledger as NDJSON, last line ``{head}``); ``list=1`` (all
        auction ids); ``kind=payments&auction=<id>`` (settlement journal and holds); ``kind=payments-global`` (webhook
        event ids and kill switch); ``kind=roomlog&auction=<id>`` (room events as NDJSON, last line ``{end}``).
        Secret-looking keys are replaced with ``[redacted]`` and webhook bodies are dropped. Errors are ``{"error":
        "<code>"}``.

        Args:
            auction: Auction id (``auctionId`` is accepted as an alias).
            list_: Send ``1`` to list every auction id instead of exporting one auction.
            kind: Which export to return. Without it, ``auction`` returns the ledger.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/admin/export"),
            query_params=[
                param[str | None]("auction", auction),
                param[ListOrStr | None]("list", list_),
                param[KindOrStr | None]("kind", kind),
            ],
            auth_scheme=self._auth.admin_key,
            decoder=async_empty_response,
            error_mapper=admin_export_error_mapper,
            request_options=request_options,
        )

    async def admin_replay_bundle(
        self, auction_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Any, AdminReplayBundleErrorBody]:
        """Operator only. A self-contained bundle of the auction's ledger for replay and verification. Query
        ``auctionId`` is required. 409 when the hash chain is broken.

        Args:
            auction_id: Id of the auction to bundle.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/admin/replay-bundle"),
            query_params=[param[str]("auctionId", auction_id)],
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[Any],
            error_mapper=admin_replay_bundle_error_mapper,
            request_options=request_options,
        )

    async def export_events(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[None, ExportEventsErrorBody]:
        """Auctioneer token or operator key. One JSON object per line, in sequence order, with personal fields removed
        for everyone but the operator. If the store has a gap the connection is cut instead of ending quietly, so a
        short file never looks complete. This route is served by the host directly: its errors are ``{"error":
        "<code>"}`` only.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/export"),
            path_params=[param[str]("id", id_)],
            auth_scheme=AsyncAnySchemes(self._auth.auctioneer_auth, self._auth.admin_key),
            decoder=async_empty_response,
            error_mapper=export_events_error_mapper,
            request_options=request_options,
        )

    async def get_judge_room_ledger(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ReplayBundle, GetJudgeRoomLedgerErrorBody]:
        """Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay bundle with the private
        fields removed. The private chain and the public chain are both checked before anything is sent: a broken chain
        answers 409 ``ledger_unverified`` instead of a bundle that looks fine. 404 before the ledger has any entry, for
        an id that is not a judge room, or when judge rooms are off.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/judge/rooms/{id}/ledger"),
            path_params=[param[str]("id", id_)],
            auth_scheme=AsyncAnySchemes(self._auth.reviewer_auth, self._auth.auctioneer_auth),
            decoder=async_json_decoder[ReplayBundle],
            error_mapper=get_judge_room_ledger_error_mapper,
            request_options=request_options,
        )
