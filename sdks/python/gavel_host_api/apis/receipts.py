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
    json_decoder,
    param,
    unwrap,
)
from ..errors.create_receipt_link_error import CreateReceiptLinkErrorBody, create_receipt_link_error_mapper
from ..errors.get_receipt_error import GetReceiptErrorBody, get_receipt_error_mapper
from ..models.api_auctions_receipt_link_response import ApiAuctionsReceiptLinkResponse
from ..models.api_auctions_receipt_response import ApiAuctionsReceiptResponse
from ..server.server import Server


class Receipts:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = ReceiptsWithRawResponse(client, server, auth)

    def create_receipt_link(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiAuctionsReceiptLinkResponse:
        """Session token only. Returns a receipt token (valid 4 hours) that opens exactly one read-only route, ``GET
        /api/auctions/{id}/receipt``, for this bidder.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Receipt link.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.create_receipt_link(id_, request_options=request_options))

    def get_receipt(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiAuctionsReceiptResponse:
        """Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own roster row and own
        hold. The winner keeps a paddle but loses the name, every other bidder is dropped, and the ceiling, the join
        code and the audit rows are removed.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The receipt.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_receipt(id_, request_options=request_options))

    @property
    def with_raw_response(self) -> ReceiptsWithRawResponse:
        return self._with_raw_response


class AsyncReceipts:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncReceiptsWithRawResponse(client, server, auth)

    async def create_receipt_link(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiAuctionsReceiptLinkResponse:
        """Session token only. Returns a receipt token (valid 4 hours) that opens exactly one read-only route, ``GET
        /api/auctions/{id}/receipt``, for this bidder.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Receipt link.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. The
                credential is valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.create_receipt_link(id_, request_options=request_options))

    async def get_receipt(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiAuctionsReceiptResponse:
        """Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own roster row and own
        hold. The winner keeps a paddle but loses the name, every other bidder is dropped, and the ceiling, the join
        code and the audit rows are removed.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The receipt.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_receipt(id_, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncReceiptsWithRawResponse:
        return self._with_raw_response


class ReceiptsWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def create_receipt_link(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiAuctionsReceiptLinkResponse, CreateReceiptLinkErrorBody]:
        """Session token only. Returns a receipt token (valid 4 hours) that opens exactly one read-only route, ``GET
        /api/auctions/{id}/receipt``, for this bidder.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/receipt-link"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[ApiAuctionsReceiptLinkResponse],
            error_mapper=create_receipt_link_error_mapper,
            request_options=request_options,
        )

    def get_receipt(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiAuctionsReceiptResponse, GetReceiptErrorBody]:
        """Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own roster row and own
        hold. The winner keeps a paddle but loses the name, every other bidder is dropped, and the ceiling, the join
        code and the audit rows are removed.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/receipt"),
            path_params=[param[str]("id", id_)],
            auth_scheme=self._auth.receipt_auth,
            decoder=json_decoder[ApiAuctionsReceiptResponse],
            error_mapper=get_receipt_error_mapper,
            request_options=request_options,
        )


class AsyncReceiptsWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def create_receipt_link(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiAuctionsReceiptLinkResponse, CreateReceiptLinkErrorBody]:
        """Session token only. Returns a receipt token (valid 4 hours) that opens exactly one read-only route, ``GET
        /api/auctions/{id}/receipt``, for this bidder.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/receipt-link"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[ApiAuctionsReceiptLinkResponse],
            error_mapper=create_receipt_link_error_mapper,
            request_options=request_options,
        )

    async def get_receipt(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiAuctionsReceiptResponse, GetReceiptErrorBody]:
        """Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own roster row and own
        hold. The winner keeps a paddle but loses the name, every other bidder is dropped, and the ceiling, the join
        code and the audit rows are removed.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}/receipt"),
            path_params=[param[str]("id", id_)],
            auth_scheme=self._auth.receipt_auth,
            decoder=async_json_decoder[ApiAuctionsReceiptResponse],
            error_mapper=get_receipt_error_mapper,
            request_options=request_options,
        )
