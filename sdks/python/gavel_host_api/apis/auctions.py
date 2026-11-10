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
from ..errors.create_auction_error import CreateAuctionErrorBody, create_auction_error_mapper
from ..errors.get_auction_error import GetAuctionErrorBody, get_auction_error_mapper
from ..errors.revoke_all_auctioneer_tokens_error import (
    RevokeAllAuctioneerTokensErrorBody,
    revoke_all_auctioneer_tokens_error_mapper,
)
from ..errors.revoke_auctioneer_token_error import RevokeAuctioneerTokenErrorBody, revoke_auctioneer_token_error_mapper
from ..errors.rotate_auctioneer_token_error import RotateAuctioneerTokenErrorBody, rotate_auctioneer_token_error_mapper
from ..models.api_auctions_auctioneer_revoke_request import (
    ApiAuctionsAuctioneerRevokeRequest,
    ApiAuctionsAuctioneerRevokeRequestDict,
)
from ..models.api_auctions_auctioneer_rotate_response import ApiAuctionsAuctioneerRotateResponse
from ..models.auction_public import AuctionPublic
from ..models.create_auction_request import CreateAuctionRequest, CreateAuctionRequestDict
from ..models.create_auction_response import CreateAuctionResponse
from ..models.revoked import Revoked
from ..server.server import Server


class Auctions:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = AuctionsWithRawResponse(client, server, auth)

    def create_auction(
        self,
        body: CreateAuctionRequest | CreateAuctionRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> CreateAuctionResponse:
        """Operator only. Creates the auction, reserves a 6 character join code, and returns links for the auctioneer
        console and the projector screen. The tokens are inside the links (fragment ``#token=``), valid 12 hours.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Auction created.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The body is larger
                than 64 KiB (``bad_message``). A body was sent that is not ``application/json`` (``bad_message``). Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(self._with_raw_response.create_auction(body, request_options=request_options))

    def get_auction(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> AuctionPublic:
        """No credential. ``id`` is the auction id or its join code (any case; spaces, dashes and a ``GVL-`` prefix are
        ignored). Looking up by code is guess-protected: after 5 wrong codes a source address is locked out for 15
        minutes (429 ``code_locked``).

        Args:
            id_: Auction id, or its 6 character join code.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The auction.

        Raises:
            ApiError: No such auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a
                locked-out source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or
                a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_auction(id_, request_options=request_options))

    def revoke_all_auctioneer_tokens(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> Revoked:
        """Operator only. Kills every auctioneer token of the auction and issues no new one.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Revoked.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.revoke_all_auctioneer_tokens(id_, request_options=request_options))

    def revoke_auctioneer_token(
        self,
        id_: str,
        body: ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> Revoked:
        """Operator only. For a lost or leaked link when you know its token id.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Revoked.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. No such auction,
                bidder, room or route (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent
                that is not ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.revoke_auctioneer_token(id_, body, request_options=request_options))

    def rotate_auctioneer_token(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiAuctionsAuctioneerRotateResponse:
        """Operator only. Kills every auctioneer token issued before now and returns a fresh link. A leaked auctioneer
        link cannot do this, by design.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            New auctioneer link.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.rotate_auctioneer_token(id_, request_options=request_options))

    @property
    def with_raw_response(self) -> AuctionsWithRawResponse:
        return self._with_raw_response


class AsyncAuctions:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncAuctionsWithRawResponse(client, server, auth)

    async def create_auction(
        self,
        body: CreateAuctionRequest | CreateAuctionRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> CreateAuctionResponse:
        """Operator only. Creates the auction, reserves a 6 character join code, and returns links for the auctioneer
        console and the projector screen. The tokens are inside the links (fragment ``#token=``), valid 12 hours.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Auction created.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The body is larger
                than 64 KiB (``bad_message``). A body was sent that is not ``application/json`` (``bad_message``). Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(await self._with_raw_response.create_auction(body, request_options=request_options))

    async def get_auction(self, id_: str, *, request_options: RequestOptionsOrDict | None = None) -> AuctionPublic:
        """No credential. ``id`` is the auction id or its join code (any case; spaces, dashes and a ``GVL-`` prefix are
        ignored). Looking up by code is guess-protected: after 5 wrong codes a source address is locked out for 15
        minutes (429 ``code_locked``).

        Args:
            id_: Auction id, or its 6 character join code.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The auction.

        Raises:
            ApiError: No such auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a
                locked-out source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or
                a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_auction(id_, request_options=request_options))

    async def revoke_all_auctioneer_tokens(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> Revoked:
        """Operator only. Kills every auctioneer token of the auction and issues no new one.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Revoked.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.revoke_all_auctioneer_tokens(id_, request_options=request_options))

    async def revoke_auctioneer_token(
        self,
        id_: str,
        body: ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> Revoked:
        """Operator only. For a lost or leaked link when you know its token id.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Revoked.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. No such auction,
                bidder, room or route (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent
                that is not ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.revoke_auctioneer_token(id_, body, request_options=request_options))

    async def rotate_auctioneer_token(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiAuctionsAuctioneerRotateResponse:
        """Operator only. Kills every auctioneer token issued before now and returns a fresh link. A leaked auctioneer
        link cannot do this, by design.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            New auctioneer link.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.rotate_auctioneer_token(id_, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncAuctionsWithRawResponse:
        return self._with_raw_response


class AuctionsWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def create_auction(
        self,
        body: CreateAuctionRequest | CreateAuctionRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[CreateAuctionResponse, CreateAuctionErrorBody]:
        """Operator only. Creates the auction, reserves a 6 character join code, and returns links for the auctioneer
        console and the projector screen. The tokens are inside the links (fragment ``#token=``), valid 12 hours.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CreateAuctionRequest | CreateAuctionRequestDict](body),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[CreateAuctionResponse],
            error_mapper=create_auction_error_mapper,
            request_options=request_options,
        )

    def get_auction(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[AuctionPublic, GetAuctionErrorBody]:
        """No credential. ``id`` is the auction id or its join code (any case; spaces, dashes and a ``GVL-`` prefix are
        ignored). Looking up by code is guess-protected: after 5 wrong codes a source address is locked out for 15
        minutes (429 ``code_locked``).

        Args:
            id_: Auction id, or its 6 character join code.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}"),
            path_params=[param[str]("id", id_)],
            decoder=json_decoder[AuctionPublic],
            error_mapper=get_auction_error_mapper,
            request_options=request_options,
        )

    def revoke_all_auctioneer_tokens(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Revoked, RevokeAllAuctioneerTokensErrorBody]:
        """Operator only. Kills every auctioneer token of the auction and issues no new one.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/auctioneer/revoke-all"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[Revoked],
            error_mapper=revoke_all_auctioneer_tokens_error_mapper,
            request_options=request_options,
        )

    def revoke_auctioneer_token(
        self,
        id_: str,
        body: ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[Revoked, RevokeAuctioneerTokenErrorBody]:
        """Operator only. For a lost or leaked link when you know its token id.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/auctioneer/revoke"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict](body),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[Revoked],
            error_mapper=revoke_auctioneer_token_error_mapper,
            request_options=request_options,
        )

    def rotate_auctioneer_token(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiAuctionsAuctioneerRotateResponse, RotateAuctioneerTokenErrorBody]:
        """Operator only. Kills every auctioneer token issued before now and returns a fresh link. A leaked auctioneer
        link cannot do this, by design.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/auctioneer/rotate"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[ApiAuctionsAuctioneerRotateResponse],
            error_mapper=rotate_auctioneer_token_error_mapper,
            request_options=request_options,
        )


class AsyncAuctionsWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def create_auction(
        self,
        body: CreateAuctionRequest | CreateAuctionRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[CreateAuctionResponse, CreateAuctionErrorBody]:
        """Operator only. Creates the auction, reserves a 6 character join code, and returns links for the auctioneer
        console and the projector screen. The tokens are inside the links (fragment ``#token=``), valid 12 hours.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CreateAuctionRequest | CreateAuctionRequestDict](body),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[CreateAuctionResponse],
            error_mapper=create_auction_error_mapper,
            request_options=request_options,
        )

    async def get_auction(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[AuctionPublic, GetAuctionErrorBody]:
        """No credential. ``id`` is the auction id or its join code (any case; spaces, dashes and a ``GVL-`` prefix are
        ignored). Looking up by code is guess-protected: after 5 wrong codes a source address is locked out for 15
        minutes (429 ``code_locked``).

        Args:
            id_: Auction id, or its 6 character join code.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/auctions/{id}"),
            path_params=[param[str]("id", id_)],
            decoder=async_json_decoder[AuctionPublic],
            error_mapper=get_auction_error_mapper,
            request_options=request_options,
        )

    async def revoke_all_auctioneer_tokens(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Revoked, RevokeAllAuctioneerTokensErrorBody]:
        """Operator only. Kills every auctioneer token of the auction and issues no new one.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/auctioneer/revoke-all"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[Revoked],
            error_mapper=revoke_all_auctioneer_tokens_error_mapper,
            request_options=request_options,
        )

    async def revoke_auctioneer_token(
        self,
        id_: str,
        body: ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[Revoked, RevokeAuctioneerTokenErrorBody]:
        """Operator only. For a lost or leaked link when you know its token id.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/auctioneer/revoke"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict](body),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[Revoked],
            error_mapper=revoke_auctioneer_token_error_mapper,
            request_options=request_options,
        )

    async def rotate_auctioneer_token(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiAuctionsAuctioneerRotateResponse, RotateAuctioneerTokenErrorBody]:
        """Operator only. Kills every auctioneer token issued before now and returns a fresh link. A leaked auctioneer
        link cannot do this, by design.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/auctions/{id}/auctioneer/rotate"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[ApiAuctionsAuctioneerRotateResponse],
            error_mapper=rotate_auctioneer_token_error_mapper,
            request_options=request_options,
        )
