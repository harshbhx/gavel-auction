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
from ..errors.abandon_hold_error import AbandonHoldErrorBody, abandon_hold_error_mapper
from ..errors.approve_hold_error import ApproveHoldErrorBody, approve_hold_error_mapper
from ..errors.create_hold_error import CreateHoldErrorBody, create_hold_error_mapper
from ..errors.get_hold_error import GetHoldErrorBody, get_hold_error_mapper
from ..models.api_holds_approve_request import ApiHoldsApproveRequest, ApiHoldsApproveRequestDict
from ..models.api_holds_approve_response import ApiHoldsApproveResponse
from ..models.api_holds_request import ApiHoldsRequest, ApiHoldsRequestDict
from ..models.api_holds_response import ApiHoldsResponse
from ..models.api_holds_response1 import ApiHoldsResponse1
from ..models.create_hold_response import CreateHoldResponse
from ..server.server import Server


class Holds:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = HoldsWithRawResponse(client, server, auth)

    def abandon_hold(self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiHoldsResponse1:
        """Session token of the hold's owner. Idempotent. A hold that is already authorized is not released: it answers
        409 ``hold_exists``.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Released (now or before).

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                hold, or it belongs to another bidder (``order_not_found``). A hold already exists or is authorized
                (``hold_exists``), the order is not approved yet (``order_not_approved``) or the auction no longer takes
                holds (``closed``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.abandon_hold(hold_id, request_options=request_options))

    def approve_hold(
        self,
        hold_id: str,
        body: ApiHoldsApproveRequest | ApiHoldsApproveRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiHoldsApproveResponse:
        """Session token of the hold's owner. Another bidder's hold answers 404, exactly like an unknown hold. When
        ``name`` is sent, the bidder is also registered in the room once the hold is authorized (idempotent).

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Hold authorized.

        Raises:
            ApiError: Invalid body (``bad_message``) or a ceiling the auction does not offer (``ceiling_out_of_range``).
                The credential is missing, expired, revoked, of the wrong kind or for another auction. No such hold, or
                it belongs to another bidder (``order_not_found``). A hold already exists or is authorized
                (``hold_exists``), the order is not approved yet (``order_not_approved``) or the auction no longer takes
                holds (``closed``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. PayPal is unreachable (``paypal_unavailable``), the kill switch is on
                (``kill_switch_engaged``) or the host is not in sandbox mode (``payments_not_sandbox``). ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.approve_hold(hold_id, body, request_options=request_options))

    def create_hold(
        self, body: ApiHoldsRequest | ApiHoldsRequestDict, *, request_options: RequestOptionsOrDict | None = None
    ) -> CreateHoldResponse:
        """Session token only. The bidder is the one in the token; a body that names a bidder is rejected. The ceiling
        must be one of the auction's offered presets. Errors on the hold routes are ``{error, message}`` with the codes
        in ``HoldErrorCode``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Hold order created; approve it with PayPal, then call the approve route.

        Raises:
            ApiError: Invalid body (``bad_message``) or a ceiling the auction does not offer (``ceiling_out_of_range``).
                The credential is missing, expired, revoked, of the wrong kind or for another auction. No such hold, or
                it belongs to another bidder (``order_not_found``). A hold already exists or is authorized
                (``hold_exists``), the order is not approved yet (``order_not_approved``) or the auction no longer takes
                holds (``closed``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. PayPal is unreachable (``paypal_unavailable``), the kill switch is on
                (``kill_switch_engaged``) or the host is not in sandbox mode (``payments_not_sandbox``). ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.create_hold(body, request_options=request_options))

    def get_hold(self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiHoldsResponse:
        """Session token of the hold's owner. Anyone else's hold answers 404.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The hold.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                hold, or it belongs to another bidder (``order_not_found``). Too many requests (``rate_limited``), a
                locked-out source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or
                a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_hold(hold_id, request_options=request_options))

    @property
    def with_raw_response(self) -> HoldsWithRawResponse:
        return self._with_raw_response


class AsyncHolds:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncHoldsWithRawResponse(client, server, auth)

    async def abandon_hold(
        self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiHoldsResponse1:
        """Session token of the hold's owner. Idempotent. A hold that is already authorized is not released: it answers
        409 ``hold_exists``.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Released (now or before).

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                hold, or it belongs to another bidder (``order_not_found``). A hold already exists or is authorized
                (``hold_exists``), the order is not approved yet (``order_not_approved``) or the auction no longer takes
                holds (``closed``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.abandon_hold(hold_id, request_options=request_options))

    async def approve_hold(
        self,
        hold_id: str,
        body: ApiHoldsApproveRequest | ApiHoldsApproveRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiHoldsApproveResponse:
        """Session token of the hold's owner. Another bidder's hold answers 404, exactly like an unknown hold. When
        ``name`` is sent, the bidder is also registered in the room once the hold is authorized (idempotent).

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Hold authorized.

        Raises:
            ApiError: Invalid body (``bad_message``) or a ceiling the auction does not offer (``ceiling_out_of_range``).
                The credential is missing, expired, revoked, of the wrong kind or for another auction. No such hold, or
                it belongs to another bidder (``order_not_found``). A hold already exists or is authorized
                (``hold_exists``), the order is not approved yet (``order_not_approved``) or the auction no longer takes
                holds (``closed``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. PayPal is unreachable (``paypal_unavailable``), the kill switch is on
                (``kill_switch_engaged``) or the host is not in sandbox mode (``payments_not_sandbox``). ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.approve_hold(hold_id, body, request_options=request_options))

    async def create_hold(
        self, body: ApiHoldsRequest | ApiHoldsRequestDict, *, request_options: RequestOptionsOrDict | None = None
    ) -> CreateHoldResponse:
        """Session token only. The bidder is the one in the token; a body that names a bidder is rejected. The ceiling
        must be one of the auction's offered presets. Errors on the hold routes are ``{error, message}`` with the codes
        in ``HoldErrorCode``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Hold order created; approve it with PayPal, then call the approve route.

        Raises:
            ApiError: Invalid body (``bad_message``) or a ceiling the auction does not offer (``ceiling_out_of_range``).
                The credential is missing, expired, revoked, of the wrong kind or for another auction. No such hold, or
                it belongs to another bidder (``order_not_found``). A hold already exists or is authorized
                (``hold_exists``), the order is not approved yet (``order_not_approved``) or the auction no longer takes
                holds (``closed``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. PayPal is unreachable (``paypal_unavailable``), the kill switch is on
                (``kill_switch_engaged``) or the host is not in sandbox mode (``payments_not_sandbox``). ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.create_hold(body, request_options=request_options))

    async def get_hold(self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiHoldsResponse:
        """Session token of the hold's owner. Anyone else's hold answers 404.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The hold.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                hold, or it belongs to another bidder (``order_not_found``). Too many requests (``rate_limited``), a
                locked-out source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or
                a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_hold(hold_id, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncHoldsWithRawResponse:
        return self._with_raw_response


class HoldsWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def abandon_hold(
        self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiHoldsResponse1, AbandonHoldErrorBody]:
        """Session token of the hold's owner. Idempotent. A hold that is already authorized is not released: it answers
        409 ``hold_exists``.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="DELETE",
            url_template=self._server.default("/api/holds/{holdId}"),
            path_params=[param[str]("holdId", hold_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[ApiHoldsResponse1],
            error_mapper=abandon_hold_error_mapper,
            request_options=request_options,
        )

    def approve_hold(
        self,
        hold_id: str,
        body: ApiHoldsApproveRequest | ApiHoldsApproveRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiHoldsApproveResponse, ApproveHoldErrorBody]:
        """Session token of the hold's owner. Another bidder's hold answers 404, exactly like an unknown hold. When
        ``name`` is sent, the bidder is also registered in the room once the hold is authorized (idempotent).

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/holds/{holdId}/approve"),
            path_params=[param[str]("holdId", hold_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiHoldsApproveRequest | ApiHoldsApproveRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[ApiHoldsApproveResponse],
            error_mapper=approve_hold_error_mapper,
            request_options=request_options,
        )

    def create_hold(
        self, body: ApiHoldsRequest | ApiHoldsRequestDict, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[CreateHoldResponse, CreateHoldErrorBody]:
        """Session token only. The bidder is the one in the token; a body that names a bidder is rejected. The ceiling
        must be one of the auction's offered presets. Errors on the hold routes are ``{error, message}`` with the codes
        in ``HoldErrorCode``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/holds"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiHoldsRequest | ApiHoldsRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[CreateHoldResponse],
            error_mapper=create_hold_error_mapper,
            request_options=request_options,
        )

    def get_hold(
        self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiHoldsResponse, GetHoldErrorBody]:
        """Session token of the hold's owner. Anyone else's hold answers 404.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/holds/{holdId}"),
            path_params=[param[str]("holdId", hold_id)],
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[ApiHoldsResponse],
            error_mapper=get_hold_error_mapper,
            request_options=request_options,
        )


class AsyncHoldsWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def abandon_hold(
        self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiHoldsResponse1, AbandonHoldErrorBody]:
        """Session token of the hold's owner. Idempotent. A hold that is already authorized is not released: it answers
        409 ``hold_exists``.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="DELETE",
            url_template=self._server.default("/api/holds/{holdId}"),
            path_params=[param[str]("holdId", hold_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[ApiHoldsResponse1],
            error_mapper=abandon_hold_error_mapper,
            request_options=request_options,
        )

    async def approve_hold(
        self,
        hold_id: str,
        body: ApiHoldsApproveRequest | ApiHoldsApproveRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiHoldsApproveResponse, ApproveHoldErrorBody]:
        """Session token of the hold's owner. Another bidder's hold answers 404, exactly like an unknown hold. When
        ``name`` is sent, the bidder is also registered in the room once the hold is authorized (idempotent).

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/holds/{holdId}/approve"),
            path_params=[param[str]("holdId", hold_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiHoldsApproveRequest | ApiHoldsApproveRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[ApiHoldsApproveResponse],
            error_mapper=approve_hold_error_mapper,
            request_options=request_options,
        )

    async def create_hold(
        self, body: ApiHoldsRequest | ApiHoldsRequestDict, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[CreateHoldResponse, CreateHoldErrorBody]:
        """Session token only. The bidder is the one in the token; a body that names a bidder is rejected. The ceiling
        must be one of the auction's offered presets. Errors on the hold routes are ``{error, message}`` with the codes
        in ``HoldErrorCode``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/holds"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiHoldsRequest | ApiHoldsRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[CreateHoldResponse],
            error_mapper=create_hold_error_mapper,
            request_options=request_options,
        )

    async def get_hold(
        self, hold_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiHoldsResponse, GetHoldErrorBody]:
        """Session token of the hold's owner. Anyone else's hold answers 404.

        Args:
            hold_id: Id of the hold, as returned by the create-hold route.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/holds/{holdId}"),
            path_params=[param[str]("holdId", hold_id)],
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[ApiHoldsResponse],
            error_mapper=get_hold_error_mapper,
            request_options=request_options,
        )
