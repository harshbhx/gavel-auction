from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from ..auth import AsyncAuthSchemes, AuthSchemes
from ..core import (
    ApiResult,
    AsyncRawClient,
    RawClient,
    RequestOptionsOrDict,
    SecuredRawResponse,
    async_empty_response,
    async_json_decoder,
    async_text_decoder,
    empty_response,
    json_body,
    json_decoder,
    param,
    text_decoder,
    unwrap,
)
from ..errors.admin_export_error import AdminExportErrorBody, admin_export_error_mapper
from ..errors.admin_replay_bundle_error import AdminReplayBundleErrorBody, admin_replay_bundle_error_mapper
from ..errors.get_metrics_error import GetMetricsErrorBody, get_metrics_error_mapper
from ..errors.get_metrics_prometheus_error import GetMetricsPrometheusErrorBody, get_metrics_prometheus_error_mapper
from ..errors.get_ops_summary_error import GetOpsSummaryErrorBody, get_ops_summary_error_mapper
from ..errors.list_judge_keys_error import ListJudgeKeysErrorBody, list_judge_keys_error_mapper
from ..errors.list_ops_rooms_error import ListOpsRoomsErrorBody, list_ops_rooms_error_mapper
from ..errors.ops_release_review_error import OpsReleaseReviewErrorBody, ops_release_review_error_mapper
from ..errors.ops_void_all_error import OpsVoidAllErrorBody, ops_void_all_error_mapper
from ..errors.pause_judge_rooms_error import PauseJudgeRoomsErrorBody, pause_judge_rooms_error_mapper
from ..errors.revoke_judge_key_error import RevokeJudgeKeyErrorBody, revoke_judge_key_error_mapper
from ..models.api_judge_keys_response import ApiJudgeKeysResponse
from ..models.api_judge_keys_revoke_response import ApiJudgeKeysRevokeResponse
from ..models.api_judge_pause_request import ApiJudgePauseRequest, ApiJudgePauseRequestDict
from ..models.api_judge_pause_response import ApiJudgePauseResponse
from ..models.enums.kind import KindOrStr
from ..models.enums.list import ListOrStr
from ..models.ops_auctions_release_review_response import OpsAuctionsReleaseReviewResponse
from ..models.ops_auctions_void_all_response import OpsAuctionsVoidAllResponse
from ..models.ops_rooms_response import OpsRoomsResponse
from ..models.ops_summary_response import OpsSummaryResponse
from ..server.server import Server


class Operator:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = OperatorWithRawResponse(client, server, auth)

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

    def get_metrics(self, *, request_options: RequestOptionsOrDict | None = None) -> Any:
        """Operator only: this route is not public. Own limit of 60 requests per minute on top of the host-wide limit.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The collector snapshot.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_metrics(request_options=request_options))

    def get_metrics_prometheus(self, *, request_options: RequestOptionsOrDict | None = None) -> str:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Prometheus exposition text.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_metrics_prometheus(request_options=request_options))

    def get_ops_summary(self, *, request_options: RequestOptionsOrDict | None = None) -> OpsSummaryResponse:
        """Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Summary.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_ops_summary(request_options=request_options))

    def list_judge_keys(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiJudgeKeysResponse:
        """Operator only (``X-Admin-Key``). Lists every judge key by id with its label, limits and state. The secret and
        its hash are never returned. A judge key on this route is 401.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The keys.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Too many
                requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge
                room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something
                failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5 |
                RawError``."""
        return unwrap(self._with_raw_response.list_judge_keys(request_options=request_options))

    def list_ops_rooms(self, *, request_options: RequestOptionsOrDict | None = None) -> OpsRoomsResponse:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Loaded rooms.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.list_ops_rooms(request_options=request_options))

    def ops_release_review(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> OpsAuctionsReleaseReviewResponse:
        """Operator only. Releases the fallback candidates' holds of a settlement in review. 409 with ``busy``,
        ``no_settlement`` or ``not_in_review``.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Released.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Wrong method for a route the host serves directly. The
                ``Allow`` header names the right one. A settlement run holds the lease (``busy``), there is no
                settlement (``no_settlement``) or the settlement is not in review (``not_in_review``). Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.ops_release_review(id_, request_options=request_options))

    def ops_void_all(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> OpsAuctionsVoidAllResponse:
        """Operator only. For example while the kill switch keeps a capture waiting. Audited with the actor ``admin``.
        409 ``busy`` while a settlement run holds the lease, 409 ``no_settlement`` before the lot was hammered.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Done.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Wrong method for a route the host serves directly. The
                ``Allow`` header names the right one. A settlement run holds the lease (``busy``), there is no
                settlement (``no_settlement``) or the settlement is not in review (``not_in_review``). Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.ops_void_all(id_, request_options=request_options))

    def pause_judge_rooms(
        self,
        body: ApiJudgePauseRequest | ApiJudgePauseRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgePauseResponse:
        """Operator only. A global kill switch for the create route; the flag survives a restart.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            New state.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The body is larger
                than 64 KiB (``bad_message``). A body was sent that is not ``application/json`` (``bad_message``). Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(self._with_raw_response.pause_judge_rooms(body, request_options=request_options))

    def revoke_judge_key(
        self, key_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiJudgeKeysRevokeResponse:
        """Operator only (``X-Admin-Key``). The key is refused from now on (401 ``judge_key_revoked``) and stays revoked
        after a restart. Rooms it already opened run until they end. A judge key on this route is 401.

        Args:
            key_id: The 8 character id inside the key (``gvl_judge_<id>_<secret>``), or ``legacy``.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The key is revoked.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. The revoke could not be saved
                (``store_unavailable``). Nothing changed and the key is still usable; try again. ``error`` is ``Error5 |
                RawError``."""
        return unwrap(self._with_raw_response.revoke_judge_key(key_id, request_options=request_options))

    @property
    def with_raw_response(self) -> OperatorWithRawResponse:
        return self._with_raw_response


class AsyncOperator:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncOperatorWithRawResponse(client, server, auth)

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

    async def get_metrics(self, *, request_options: RequestOptionsOrDict | None = None) -> Any:
        """Operator only: this route is not public. Own limit of 60 requests per minute on top of the host-wide limit.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The collector snapshot.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_metrics(request_options=request_options))

    async def get_metrics_prometheus(self, *, request_options: RequestOptionsOrDict | None = None) -> str:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Prometheus exposition text.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_metrics_prometheus(request_options=request_options))

    async def get_ops_summary(self, *, request_options: RequestOptionsOrDict | None = None) -> OpsSummaryResponse:
        """Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Summary.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_ops_summary(request_options=request_options))

    async def list_judge_keys(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiJudgeKeysResponse:
        """Operator only (``X-Admin-Key``). Lists every judge key by id with its label, limits and state. The secret and
        its hash are never returned. A judge key on this route is 401.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The keys.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Too many
                requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge
                room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something
                failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5 |
                RawError``."""
        return unwrap(await self._with_raw_response.list_judge_keys(request_options=request_options))

    async def list_ops_rooms(self, *, request_options: RequestOptionsOrDict | None = None) -> OpsRoomsResponse:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Loaded rooms.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. Wrong
                method for a route the host serves directly. The ``Allow`` header names the right one. Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.list_ops_rooms(request_options=request_options))

    async def ops_release_review(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> OpsAuctionsReleaseReviewResponse:
        """Operator only. Releases the fallback candidates' holds of a settlement in review. 409 with ``busy``,
        ``no_settlement`` or ``not_in_review``.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Released.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Wrong method for a route the host serves directly. The
                ``Allow`` header names the right one. A settlement run holds the lease (``busy``), there is no
                settlement (``no_settlement``) or the settlement is not in review (``not_in_review``). Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.ops_release_review(id_, request_options=request_options))

    async def ops_void_all(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> OpsAuctionsVoidAllResponse:
        """Operator only. For example while the kill switch keeps a capture waiting. Audited with the actor ``admin``.
        409 ``busy`` while a settlement run holds the lease, 409 ``no_settlement`` before the lot was hammered.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Done.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Wrong method for a route the host serves directly. The
                ``Allow`` header names the right one. A settlement run holds the lease (``busy``), there is no
                settlement (``no_settlement``) or the settlement is not in review (``not_in_review``). Too many requests
                (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room
                (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds. ``error`` is
                ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.ops_void_all(id_, request_options=request_options))

    async def pause_judge_rooms(
        self,
        body: ApiJudgePauseRequest | ApiJudgePauseRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgePauseResponse:
        """Operator only. A global kill switch for the create route; the flag survives a restart.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            New state.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The body is larger
                than 64 KiB (``bad_message``). A body was sent that is not ``application/json`` (``bad_message``). Too
                many requests (``rate_limited``), a locked-out source (``code_locked``, ``judge_join_locked``), a full
                judge room (``judge_room_full``), or a judge-room cap or create limit. Wait ``Retry-After`` seconds.
                Something failed on the host (``internal``). The message never carries internals. ``error`` is ``Error5
                | RawError``."""
        return unwrap(await self._with_raw_response.pause_judge_rooms(body, request_options=request_options))

    async def revoke_judge_key(
        self, key_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiJudgeKeysRevokeResponse:
        """Operator only (``X-Admin-Key``). The key is refused from now on (401 ``judge_key_revoked``) and stays revoked
        after a restart. Rooms it already opened run until they end. A judge key on this route is 401.

        Args:
            key_id: The 8 character id inside the key (``gvl_judge_<id>_<secret>``), or ``legacy``.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The key is revoked.

        Raises:
            ApiError: The credential is missing, expired, revoked, of the wrong kind or for another auction. No such
                auction, bidder, room or route (``not_found``). Too many requests (``rate_limited``), a locked-out
                source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a
                judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. The revoke could not be saved
                (``store_unavailable``). Nothing changed and the key is still usable; try again. ``error`` is ``Error5 |
                RawError``."""
        return unwrap(await self._with_raw_response.revoke_judge_key(key_id, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncOperatorWithRawResponse:
        return self._with_raw_response


class OperatorWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
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

    def get_metrics(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Any, GetMetricsErrorBody]:
        """Operator only: this route is not public. Own limit of 60 requests per minute on top of the host-wide limit.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/metrics"),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[Any],
            error_mapper=get_metrics_error_mapper,
            request_options=request_options,
        )

    def get_metrics_prometheus(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[str, GetMetricsPrometheusErrorBody]:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/metrics/prometheus"),
            auth_scheme=self._auth.admin_key,
            decoder=text_decoder[str],
            error_mapper=get_metrics_prometheus_error_mapper,
            request_options=request_options,
        )

    def get_ops_summary(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsSummaryResponse, GetOpsSummaryErrorBody]:
        """Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/ops/summary"),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[OpsSummaryResponse],
            error_mapper=get_ops_summary_error_mapper,
            request_options=request_options,
        )

    def list_judge_keys(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeKeysResponse, ListJudgeKeysErrorBody]:
        """Operator only (``X-Admin-Key``). Lists every judge key by id with its label, limits and state. The secret and
        its hash are never returned. A judge key on this route is 401.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/judge/keys"),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[ApiJudgeKeysResponse],
            error_mapper=list_judge_keys_error_mapper,
            request_options=request_options,
        )

    def list_ops_rooms(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsRoomsResponse, ListOpsRoomsErrorBody]:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/ops/rooms"),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[OpsRoomsResponse],
            error_mapper=list_ops_rooms_error_mapper,
            request_options=request_options,
        )

    def ops_release_review(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsAuctionsReleaseReviewResponse, OpsReleaseReviewErrorBody]:
        """Operator only. Releases the fallback candidates' holds of a settlement in review. 409 with ``busy``,
        ``no_settlement`` or ``not_in_review``.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/ops/auctions/{id}/release-review"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[OpsAuctionsReleaseReviewResponse],
            error_mapper=ops_release_review_error_mapper,
            request_options=request_options,
        )

    def ops_void_all(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsAuctionsVoidAllResponse, OpsVoidAllErrorBody]:
        """Operator only. For example while the kill switch keeps a capture waiting. Audited with the actor ``admin``.
        409 ``busy`` while a settlement run holds the lease, 409 ``no_settlement`` before the lot was hammered.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/ops/auctions/{id}/void-all"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[OpsAuctionsVoidAllResponse],
            error_mapper=ops_void_all_error_mapper,
            request_options=request_options,
        )

    def pause_judge_rooms(
        self,
        body: ApiJudgePauseRequest | ApiJudgePauseRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgePauseResponse, PauseJudgeRoomsErrorBody]:
        """Operator only. A global kill switch for the create route; the flag survives a restart.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/pause"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgePauseRequest | ApiJudgePauseRequestDict](body),
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[ApiJudgePauseResponse],
            error_mapper=pause_judge_rooms_error_mapper,
            request_options=request_options,
        )

    def revoke_judge_key(
        self, key_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeKeysRevokeResponse, RevokeJudgeKeyErrorBody]:
        """Operator only (``X-Admin-Key``). The key is refused from now on (401 ``judge_key_revoked``) and stays revoked
        after a restart. Rooms it already opened run until they end. A judge key on this route is 401.

        Args:
            key_id: The 8 character id inside the key (``gvl_judge_<id>_<secret>``), or ``legacy``.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/keys/{keyId}/revoke"),
            path_params=[param[str]("keyId", key_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=json_decoder[ApiJudgeKeysRevokeResponse],
            error_mapper=revoke_judge_key_error_mapper,
            request_options=request_options,
        )


class AsyncOperatorWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
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

    async def get_metrics(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Any, GetMetricsErrorBody]:
        """Operator only: this route is not public. Own limit of 60 requests per minute on top of the host-wide limit.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/metrics"),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[Any],
            error_mapper=get_metrics_error_mapper,
            request_options=request_options,
        )

    async def get_metrics_prometheus(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[str, GetMetricsPrometheusErrorBody]:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/metrics/prometheus"),
            auth_scheme=self._auth.admin_key,
            decoder=async_text_decoder[str],
            error_mapper=get_metrics_prometheus_error_mapper,
            request_options=request_options,
        )

    async def get_ops_summary(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsSummaryResponse, GetOpsSummaryErrorBody]:
        """Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/ops/summary"),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[OpsSummaryResponse],
            error_mapper=get_ops_summary_error_mapper,
            request_options=request_options,
        )

    async def list_judge_keys(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeKeysResponse, ListJudgeKeysErrorBody]:
        """Operator only (``X-Admin-Key``). Lists every judge key by id with its label, limits and state. The secret and
        its hash are never returned. A judge key on this route is 401.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/judge/keys"),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[ApiJudgeKeysResponse],
            error_mapper=list_judge_keys_error_mapper,
            request_options=request_options,
        )

    async def list_ops_rooms(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsRoomsResponse, ListOpsRoomsErrorBody]:
        """Operator only.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/ops/rooms"),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[OpsRoomsResponse],
            error_mapper=list_ops_rooms_error_mapper,
            request_options=request_options,
        )

    async def ops_release_review(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsAuctionsReleaseReviewResponse, OpsReleaseReviewErrorBody]:
        """Operator only. Releases the fallback candidates' holds of a settlement in review. 409 with ``busy``,
        ``no_settlement`` or ``not_in_review``.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/ops/auctions/{id}/release-review"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[OpsAuctionsReleaseReviewResponse],
            error_mapper=ops_release_review_error_mapper,
            request_options=request_options,
        )

    async def ops_void_all(
        self, id_: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[OpsAuctionsVoidAllResponse, OpsVoidAllErrorBody]:
        """Operator only. For example while the kill switch keeps a capture waiting. Audited with the actor ``admin``.
        409 ``busy`` while a settlement run holds the lease, 409 ``no_settlement`` before the lot was hammered.

        Args:
            id_: Auction id.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/ops/auctions/{id}/void-all"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[OpsAuctionsVoidAllResponse],
            error_mapper=ops_void_all_error_mapper,
            request_options=request_options,
        )

    async def pause_judge_rooms(
        self,
        body: ApiJudgePauseRequest | ApiJudgePauseRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgePauseResponse, PauseJudgeRoomsErrorBody]:
        """Operator only. A global kill switch for the create route; the flag survives a restart.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/pause"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgePauseRequest | ApiJudgePauseRequestDict](body),
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[ApiJudgePauseResponse],
            error_mapper=pause_judge_rooms_error_mapper,
            request_options=request_options,
        )

    async def revoke_judge_key(
        self, key_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeKeysRevokeResponse, RevokeJudgeKeyErrorBody]:
        """Operator only (``X-Admin-Key``). The key is refused from now on (401 ``judge_key_revoked``) and stays revoked
        after a restart. Rooms it already opened run until they end. A judge key on this route is 401.

        Args:
            key_id: The 8 character id inside the key (``gvl_judge_<id>_<secret>``), or ``legacy``.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/keys/{keyId}/revoke"),
            path_params=[param[str]("keyId", key_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.admin_key,
            decoder=async_json_decoder[ApiJudgeKeysRevokeResponse],
            error_mapper=revoke_judge_key_error_mapper,
            request_options=request_options,
        )
