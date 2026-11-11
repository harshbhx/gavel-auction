from __future__ import annotations

from uuid import UUID, uuid4

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
    json_body,
    json_decoder,
    param,
    unwrap,
)
from ..errors.check_judge_key_error import CheckJudgeKeyErrorBody, check_judge_key_error_mapper
from ..errors.create_judge_room_error import CreateJudgeRoomErrorBody, create_judge_room_error_mapper
from ..errors.create_simulated_hold_error import CreateSimulatedHoldErrorBody, create_simulated_hold_error_mapper
from ..errors.get_judge_capabilities_error import GetJudgeCapabilitiesErrorBody, get_judge_capabilities_error_mapper
from ..errors.get_judge_room_ledger_error import GetJudgeRoomLedgerErrorBody, get_judge_room_ledger_error_mapper
from ..errors.join_judge_room_error import JoinJudgeRoomErrorBody, join_judge_room_error_mapper
from ..errors.list_judge_keys_error import ListJudgeKeysErrorBody, list_judge_keys_error_mapper
from ..errors.pause_judge_rooms_error import PauseJudgeRoomsErrorBody, pause_judge_rooms_error_mapper
from ..errors.place_judge_bid_error import PlaceJudgeBidErrorBody, place_judge_bid_error_mapper
from ..errors.revoke_judge_key_error import RevokeJudgeKeyErrorBody, revoke_judge_key_error_mapper
from ..models.api_judge_capabilities_response import ApiJudgeCapabilitiesResponse
from ..models.api_judge_join_request import ApiJudgeJoinRequest, ApiJudgeJoinRequestDict
from ..models.api_judge_join_response import ApiJudgeJoinResponse
from ..models.api_judge_key_response import ApiJudgeKeyResponse
from ..models.api_judge_keys_response import ApiJudgeKeysResponse
from ..models.api_judge_keys_revoke_response import ApiJudgeKeysRevokeResponse
from ..models.api_judge_pause_request import ApiJudgePauseRequest, ApiJudgePauseRequestDict
from ..models.api_judge_pause_response import ApiJudgePauseResponse
from ..models.api_judge_rooms_bids_request import ApiJudgeRoomsBidsRequest, ApiJudgeRoomsBidsRequestDict
from ..models.api_judge_rooms_bids_response import ApiJudgeRoomsBidsResponse
from ..models.api_judge_rooms_request import ApiJudgeRoomsRequest, ApiJudgeRoomsRequestDict
from ..models.api_judge_rooms_sim_hold_request import ApiJudgeRoomsSimHoldRequest, ApiJudgeRoomsSimHoldRequestDict
from ..models.api_judge_rooms_sim_hold_response import ApiJudgeRoomsSimHoldResponse
from ..models.judge_room import JudgeRoom
from ..models.replay_bundle import ReplayBundle
from ..server.server import Server


class JudgeRooms:
    def __init__(self, client: RawClient, server: Server, auth: AuthSchemes) -> None:
        self._with_raw_response = JudgeRoomsWithRawResponse(client, server, auth)

    def check_judge_key(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiJudgeKeyResponse:
        """Send the key in the ``X-Judge-Key`` header, with no body. Creates nothing; it lets a panel say whether the
        key works. A wrong key is 401 ``judge_key_invalid`` and counts toward a lockout of its own, separate from the
        room-code lockout (5 wrong keys, 15 minutes, per source address: 429 ``judge_key_locked``, even with the right
        key; joins are not affected). A blank key is 401 without a strike. When the host has no judge key set, every key
        answers as wrong. Answers 404 when judge rooms are off.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The key is accepted.

        Raises:
            ApiError: The judge key was not accepted (``judge_key_invalid``), it has expired (``judge_key_expired``), it
                was revoked (``judge_key_revoked``), or the host has none set. No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.check_judge_key(request_options=request_options))

    def create_judge_room(
        self,
        *,
        body: ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> JudgeRoom:
        """No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings) that ends after 30
        minutes. The creator gets auctioneer, screen and reviewer tokens for that room only; no operator route opens.
        Answers 404 when judge rooms are off.

        With the optional ``X-Judge-Key`` header the request is judged by the key alone: the public limits do not apply,
        the room does not use a public slot, and a wrong key is 401 ``judge_key_invalid`` (it never falls back to the
        public path). An empty header is 401 ``judge_key_invalid`` without a strike. Wrong keys have a lockout of their
        own, separate from the room-code lockout: 5 wrong keys, 15 minutes, per source address (429
        ``judge_key_locked``); it has no effect on joins. The response then carries ``unlocked: true``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Room created.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                judge key was not accepted (``judge_key_invalid``), it has expired (``judge_key_expired``), it was
                revoked (``judge_key_revoked``), or the host has none set. No such auction, bidder, room or route
                (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many creates from this address or from the host, or from
                this key (``judge_rate_limited``; ``Retry-After`` is the time until the oldest create leaves the hour
                window), the live-room cap is reached (``judge_room_cap``, 60 s), a keyed create hit its own room cap
                (``judge_key_room_cap``; ``Retry-After`` is the time until the soonest keyed room ends), or the source
                is locked out of keyed calls (``judge_key_locked``). The body is ``{error, code, message}``; ``code``
                repeats ``error``. Something failed on the host (``internal``). The message never carries internals.
                Judge rooms are paused (``judge_rooms_paused``, retry after 60 s), or the host-wide bound on keyed rooms
                or keyed creates per hour is reached (``judge_host_busy``; ``Retry-After`` is the time until a keyed
                room ends or the hour window frees a slot). Unlike ``judge_key_room_cap``, this is not the caller's own
                limit. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.create_judge_room(body=body, request_options=request_options))

    def create_simulated_hold(
        self,
        id_: str,
        body: ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgeRoomsSimHoldResponse:
        """Session token of a bidder in that judge room. Writes an already-authorized hold with no PayPal call and puts
        the bidder in the room, so the whole path can be tried without a PayPal login. The ceiling is any whole number
        of cents from 100 up to the room's ceiling cap (the top preset); the presets are only quick picks, and a value
        outside the range is 400 ``bad_message``. Any other auction answers 404. Answers 404 when simulated holds are
        off.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Simulated hold placed.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The request conflicts with the state of the lot or the credential: ``conflict`` (for
                example a hammer refused because the price or leader changed), ``closed``, ``invite_used``,
                ``lot_not_open``. The judge room ended (``judge_room_expired`` or ``judge_room_ended``). The body is
                larger than 64 KiB (``bad_message``). A body was sent that is not ``application/json``
                (``bad_message``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.create_simulated_hold(id_, body, request_options=request_options))

    def get_judge_capabilities(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiJudgeCapabilitiesResponse:
        """No credential. Tells a client whether it can create a room right now.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Capabilities.

        Raises:
            ApiError: Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.get_judge_capabilities(request_options=request_options))

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

    def join_judge_room(
        self,
        body: ApiJudgeJoinRequest | ApiJudgeJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgeJoinResponse:
        """No credential. A bidder joins a judge room with its 6 character code and a display name and gets a session
        token. Only judge rooms: the code of any other auction answers exactly like an unknown code (404). Wrong codes
        are counted; 5 wrong codes lock a source address out for 15 minutes (429 ``judge_join_locked``). At most 20
        bidders join one room (429 ``judge_room_full``). An ended room answers 410.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Joined.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. No
                such auction, bidder, room or route (``not_found``). The judge room ended (``judge_room_expired`` or
                ``judge_room_ended``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(self._with_raw_response.join_judge_room(body, request_options=request_options))

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

    def place_judge_bid(
        self,
        id_: str,
        body: ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgeRoomsBidsResponse:
        """Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the socket needs a
        browser ``Origin``; this route does not, and the socket rules are unchanged). Send the session token from ``POST
        /api/judge/join`` as a bearer token, after the bidder has a hold (``POST /api/judge/rooms/{id}/sim-hold``). The
        bid takes the same path as a socket bid: the per-bidder bid limit, the registered check and the auction engine
        all apply. ``amount`` is whole cents. ``mid`` is optional; send the same ``mid`` again to retry safely, the room
        answers with the original result and records nothing twice.

        A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with ``accepted: false`` and a
        ``reason``. Sending a ``mid`` again with a different ``amount`` is 409 ``conflict`` (``{error, code,
        message}``). Bids sent too fast are 429 ``rate_limited`` with ``Retry-After``. When the room cannot take the bid
        (``auction_full``, ``store_unavailable``, ``room_full``) the answer is 503. Only session tokens work here, and
        only for judge rooms: any other auction answers 404. A judge key is not needed on this route.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The bid was accepted.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The engine refused the bid (``bid_rejected``: ``accepted`` is false and ``reason`` says
                why), or the same ``mid`` was reused with a different amount (``conflict``). The judge room ended
                (``judge_room_expired`` or ``judge_room_ended``). The body is larger than 64 KiB (``bad_message``). A
                body was sent that is not ``application/json`` (``bad_message``). Too many requests (``rate_limited``),
                a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``),
                or a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. The room could not take the bid (``auction_full``,
                ``store_unavailable``, ``room_full``). Retry after a moment. ``error`` is ``Error5 |
                ApiJudgeRoomsBidsResponse21 | RawError``."""
        return unwrap(self._with_raw_response.place_judge_bid(id_, body, request_options=request_options))

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
    def with_raw_response(self) -> JudgeRoomsWithRawResponse:
        return self._with_raw_response


class AsyncJudgeRooms:
    def __init__(self, client: AsyncRawClient, server: Server, auth: AsyncAuthSchemes) -> None:
        self._with_raw_response = AsyncJudgeRoomsWithRawResponse(client, server, auth)

    async def check_judge_key(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiJudgeKeyResponse:
        """Send the key in the ``X-Judge-Key`` header, with no body. Creates nothing; it lets a panel say whether the
        key works. A wrong key is 401 ``judge_key_invalid`` and counts toward a lockout of its own, separate from the
        room-code lockout (5 wrong keys, 15 minutes, per source address: 429 ``judge_key_locked``, even with the right
        key; joins are not affected). A blank key is 401 without a strike. When the host has no judge key set, every key
        answers as wrong. Answers 404 when judge rooms are off.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The key is accepted.

        Raises:
            ApiError: The judge key was not accepted (``judge_key_invalid``), it has expired (``judge_key_expired``), it
                was revoked (``judge_key_revoked``), or the host has none set. No such auction, bidder, room or route
                (``not_found``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.check_judge_key(request_options=request_options))

    async def create_judge_room(
        self,
        *,
        body: ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> JudgeRoom:
        """No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings) that ends after 30
        minutes. The creator gets auctioneer, screen and reviewer tokens for that room only; no operator route opens.
        Answers 404 when judge rooms are off.

        With the optional ``X-Judge-Key`` header the request is judged by the key alone: the public limits do not apply,
        the room does not use a public slot, and a wrong key is 401 ``judge_key_invalid`` (it never falls back to the
        public path). An empty header is 401 ``judge_key_invalid`` without a strike. Wrong keys have a lockout of their
        own, separate from the room-code lockout: 5 wrong keys, 15 minutes, per source address (429
        ``judge_key_locked``); it has no effect on joins. The response then carries ``unlocked: true``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Room created.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                judge key was not accepted (``judge_key_invalid``), it has expired (``judge_key_expired``), it was
                revoked (``judge_key_revoked``), or the host has none set. No such auction, bidder, room or route
                (``not_found``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many creates from this address or from the host, or from
                this key (``judge_rate_limited``; ``Retry-After`` is the time until the oldest create leaves the hour
                window), the live-room cap is reached (``judge_room_cap``, 60 s), a keyed create hit its own room cap
                (``judge_key_room_cap``; ``Retry-After`` is the time until the soonest keyed room ends), or the source
                is locked out of keyed calls (``judge_key_locked``). The body is ``{error, code, message}``; ``code``
                repeats ``error``. Something failed on the host (``internal``). The message never carries internals.
                Judge rooms are paused (``judge_rooms_paused``, retry after 60 s), or the host-wide bound on keyed rooms
                or keyed creates per hour is reached (``judge_host_busy``; ``Retry-After`` is the time until a keyed
                room ends or the hour window frees a slot). Unlike ``judge_key_room_cap``, this is not the caller's own
                limit. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.create_judge_room(body=body, request_options=request_options))

    async def create_simulated_hold(
        self,
        id_: str,
        body: ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgeRoomsSimHoldResponse:
        """Session token of a bidder in that judge room. Writes an already-authorized hold with no PayPal call and puts
        the bidder in the room, so the whole path can be tried without a PayPal login. The ceiling is any whole number
        of cents from 100 up to the room's ceiling cap (the top preset); the presets are only quick picks, and a value
        outside the range is 400 ``bad_message``. Any other auction answers 404. Answers 404 when simulated holds are
        off.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Simulated hold placed.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The request conflicts with the state of the lot or the credential: ``conflict`` (for
                example a hammer refused because the price or leader changed), ``closed``, ``invite_used``,
                ``lot_not_open``. The judge room ended (``judge_room_expired`` or ``judge_room_ended``). The body is
                larger than 64 KiB (``bad_message``). A body was sent that is not ``application/json``
                (``bad_message``). Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.create_simulated_hold(id_, body, request_options=request_options))

    async def get_judge_capabilities(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiJudgeCapabilitiesResponse:
        """No credential. Tells a client whether it can create a room right now.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Capabilities.

        Raises:
            ApiError: Too many requests (``rate_limited``), a locked-out source (``code_locked``,
                ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap or create limit.
                Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message never carries
                internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.get_judge_capabilities(request_options=request_options))

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

    async def join_judge_room(
        self,
        body: ApiJudgeJoinRequest | ApiJudgeJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgeJoinResponse:
        """No credential. A bidder joins a judge room with its 6 character code and a display name and gets a session
        token. Only judge rooms: the code of any other auction answers exactly like an unknown code (404). Wrong codes
        are counted; 5 wrong codes lock a source address out for 15 minutes (429 ``judge_join_locked``). At most 20
        bidders join one room (429 ``judge_room_full``). An ended room answers 410.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Joined.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. No
                such auction, bidder, room or route (``not_found``). The judge room ended (``judge_room_expired`` or
                ``judge_room_ended``). The body is larger than 64 KiB (``bad_message``). A body was sent that is not
                ``application/json`` (``bad_message``). Too many requests (``rate_limited``), a locked-out source
                (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``), or a judge-room cap
                or create limit. Wait ``Retry-After`` seconds. Something failed on the host (``internal``). The message
                never carries internals. ``error`` is ``Error5 | RawError``."""
        return unwrap(await self._with_raw_response.join_judge_room(body, request_options=request_options))

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

    async def place_judge_bid(
        self,
        id_: str,
        body: ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiJudgeRoomsBidsResponse:
        """Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the socket needs a
        browser ``Origin``; this route does not, and the socket rules are unchanged). Send the session token from ``POST
        /api/judge/join`` as a bearer token, after the bidder has a hold (``POST /api/judge/rooms/{id}/sim-hold``). The
        bid takes the same path as a socket bid: the per-bidder bid limit, the registered check and the auction engine
        all apply. ``amount`` is whole cents. ``mid`` is optional; send the same ``mid`` again to retry safely, the room
        answers with the original result and records nothing twice.

        A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with ``accepted: false`` and a
        ``reason``. Sending a ``mid`` again with a different ``amount`` is 409 ``conflict`` (``{error, code,
        message}``). Bids sent too fast are 429 ``rate_limited`` with ``Retry-After``. When the room cannot take the bid
        (``auction_full``, ``store_unavailable``, ``room_full``) the answer is 503. Only session tokens work here, and
        only for judge rooms: any other auction answers 404. A judge key is not needed on this route.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The bid was accepted.

        Raises:
            ApiError: The body, query or path is not valid (``bad_message``). ``detail`` lists the failing fields. The
                credential is missing, expired, revoked, of the wrong kind or for another auction. The credential is
                valid but its role may not do this (``forbidden``). No such auction, bidder, room or route
                (``not_found``). The engine refused the bid (``bid_rejected``: ``accepted`` is false and ``reason`` says
                why), or the same ``mid`` was reused with a different amount (``conflict``). The judge room ended
                (``judge_room_expired`` or ``judge_room_ended``). The body is larger than 64 KiB (``bad_message``). A
                body was sent that is not ``application/json`` (``bad_message``). Too many requests (``rate_limited``),
                a locked-out source (``code_locked``, ``judge_join_locked``), a full judge room (``judge_room_full``),
                or a judge-room cap or create limit. Wait ``Retry-After`` seconds. Something failed on the host
                (``internal``). The message never carries internals. The room could not take the bid (``auction_full``,
                ``store_unavailable``, ``room_full``). Retry after a moment. ``error`` is ``Error5 |
                ApiJudgeRoomsBidsResponse21 | RawError``."""
        return unwrap(await self._with_raw_response.place_judge_bid(id_, body, request_options=request_options))

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
    def with_raw_response(self) -> AsyncJudgeRoomsWithRawResponse:
        return self._with_raw_response


class JudgeRoomsWithRawResponse(SecuredRawResponse[RawClient, Server, AuthSchemes]):
    def check_judge_key(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeKeyResponse, CheckJudgeKeyErrorBody]:
        """Send the key in the ``X-Judge-Key`` header, with no body. Creates nothing; it lets a panel say whether the
        key works. A wrong key is 401 ``judge_key_invalid`` and counts toward a lockout of its own, separate from the
        room-code lockout (5 wrong keys, 15 minutes, per source address: 429 ``judge_key_locked``, even with the right
        key; joins are not affected). A blank key is 401 without a strike. When the host has no judge key set, every key
        answers as wrong. Answers 404 when judge rooms are off.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/key"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.judge_key,
            decoder=json_decoder[ApiJudgeKeyResponse],
            error_mapper=check_judge_key_error_mapper,
            request_options=request_options,
        )

    def create_judge_room(
        self,
        *,
        body: ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[JudgeRoom, CreateJudgeRoomErrorBody]:
        """No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings) that ends after 30
        minutes. The creator gets auctioneer, screen and reviewer tokens for that room only; no operator route opens.
        Answers 404 when judge rooms are off.

        With the optional ``X-Judge-Key`` header the request is judged by the key alone: the public limits do not apply,
        the room does not use a public slot, and a wrong key is 401 ``judge_key_invalid`` (it never falls back to the
        public path). An empty header is 401 ``judge_key_invalid`` without a strike. Wrong keys have a lockout of their
        own, separate from the room-code lockout: 5 wrong keys, 15 minutes, per source address (429
        ``judge_key_locked``); it has no effect on joins. The response then carries ``unlocked: true``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/rooms"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None](body),
            auth_scheme=self._auth.judge_key,
            decoder=json_decoder[JudgeRoom],
            error_mapper=create_judge_room_error_mapper,
            request_options=request_options,
        )

    def create_simulated_hold(
        self,
        id_: str,
        body: ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgeRoomsSimHoldResponse, CreateSimulatedHoldErrorBody]:
        """Session token of a bidder in that judge room. Writes an already-authorized hold with no PayPal call and puts
        the bidder in the room, so the whole path can be tried without a PayPal login. The ceiling is any whole number
        of cents from 100 up to the room's ceiling cap (the top preset); the presets are only quick picks, and a value
        outside the range is 400 ``bad_message``. Any other auction answers 404. Answers 404 when simulated holds are
        off.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/rooms/{id}/sim-hold"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[ApiJudgeRoomsSimHoldResponse],
            error_mapper=create_simulated_hold_error_mapper,
            request_options=request_options,
        )

    def get_judge_capabilities(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeCapabilitiesResponse, GetJudgeCapabilitiesErrorBody]:
        """No credential. Tells a client whether it can create a room right now.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/judge/capabilities"),
            decoder=json_decoder[ApiJudgeCapabilitiesResponse],
            error_mapper=get_judge_capabilities_error_mapper,
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

    def join_judge_room(
        self,
        body: ApiJudgeJoinRequest | ApiJudgeJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgeJoinResponse, JoinJudgeRoomErrorBody]:
        """No credential. A bidder joins a judge room with its 6 character code and a display name and gets a session
        token. Only judge rooms: the code of any other auction answers exactly like an unknown code (404). Wrong codes
        are counted; 5 wrong codes lock a source address out for 15 minutes (429 ``judge_join_locked``). At most 20
        bidders join one room (429 ``judge_room_full``). An ended room answers 410.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/join"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeJoinRequest | ApiJudgeJoinRequestDict](body),
            decoder=json_decoder[ApiJudgeJoinResponse],
            error_mapper=join_judge_room_error_mapper,
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

    def place_judge_bid(
        self,
        id_: str,
        body: ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgeRoomsBidsResponse, PlaceJudgeBidErrorBody]:
        """Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the socket needs a
        browser ``Origin``; this route does not, and the socket rules are unchanged). Send the session token from ``POST
        /api/judge/join`` as a bearer token, after the bidder has a hold (``POST /api/judge/rooms/{id}/sim-hold``). The
        bid takes the same path as a socket bid: the per-bidder bid limit, the registered check and the auction engine
        all apply. ``amount`` is whole cents. ``mid`` is optional; send the same ``mid`` again to retry safely, the room
        answers with the original result and records nothing twice.

        A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with ``accepted: false`` and a
        ``reason``. Sending a ``mid`` again with a different ``amount`` is 409 ``conflict`` (``{error, code,
        message}``). Bids sent too fast are 429 ``rate_limited`` with ``Retry-After``. When the room cannot take the bid
        (``auction_full``, ``store_unavailable``, ``room_full``) the answer is 503. Only session tokens work here, and
        only for judge rooms: any other auction answers 404. A judge key is not needed on this route.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/rooms/{id}/bids"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=json_decoder[ApiJudgeRoomsBidsResponse],
            error_mapper=place_judge_bid_error_mapper,
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


class AsyncJudgeRoomsWithRawResponse(SecuredRawResponse[AsyncRawClient, Server, AsyncAuthSchemes]):
    async def check_judge_key(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeKeyResponse, CheckJudgeKeyErrorBody]:
        """Send the key in the ``X-Judge-Key`` header, with no body. Creates nothing; it lets a panel say whether the
        key works. A wrong key is 401 ``judge_key_invalid`` and counts toward a lockout of its own, separate from the
        room-code lockout (5 wrong keys, 15 minutes, per source address: 429 ``judge_key_locked``, even with the right
        key; joins are not affected). A blank key is 401 without a strike. When the host has no judge key set, every key
        answers as wrong. Answers 404 when judge rooms are off.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/key"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            auth_scheme=self._auth.judge_key,
            decoder=async_json_decoder[ApiJudgeKeyResponse],
            error_mapper=check_judge_key_error_mapper,
            request_options=request_options,
        )

    async def create_judge_room(
        self,
        *,
        body: ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[JudgeRoom, CreateJudgeRoomErrorBody]:
        """No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings) that ends after 30
        minutes. The creator gets auctioneer, screen and reviewer tokens for that room only; no operator route opens.
        Answers 404 when judge rooms are off.

        With the optional ``X-Judge-Key`` header the request is judged by the key alone: the public limits do not apply,
        the room does not use a public slot, and a wrong key is 401 ``judge_key_invalid`` (it never falls back to the
        public path). An empty header is 401 ``judge_key_invalid`` without a strike. Wrong keys have a lockout of their
        own, separate from the room-code lockout: 5 wrong keys, 15 minutes, per source address (429
        ``judge_key_locked``); it has no effect on joins. The response then carries ``unlocked: true``.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/rooms"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None](body),
            auth_scheme=self._auth.judge_key,
            decoder=async_json_decoder[JudgeRoom],
            error_mapper=create_judge_room_error_mapper,
            request_options=request_options,
        )

    async def create_simulated_hold(
        self,
        id_: str,
        body: ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgeRoomsSimHoldResponse, CreateSimulatedHoldErrorBody]:
        """Session token of a bidder in that judge room. Writes an already-authorized hold with no PayPal call and puts
        the bidder in the room, so the whole path can be tried without a PayPal login. The ceiling is any whole number
        of cents from 100 up to the room's ceiling cap (the top preset); the presets are only quick picks, and a value
        outside the range is 400 ``bad_message``. Any other auction answers 404. Answers 404 when simulated holds are
        off.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/rooms/{id}/sim-hold"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[ApiJudgeRoomsSimHoldResponse],
            error_mapper=create_simulated_hold_error_mapper,
            request_options=request_options,
        )

    async def get_judge_capabilities(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[ApiJudgeCapabilitiesResponse, GetJudgeCapabilitiesErrorBody]:
        """No credential. Tells a client whether it can create a room right now.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/judge/capabilities"),
            decoder=async_json_decoder[ApiJudgeCapabilitiesResponse],
            error_mapper=get_judge_capabilities_error_mapper,
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

    async def join_judge_room(
        self,
        body: ApiJudgeJoinRequest | ApiJudgeJoinRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgeJoinResponse, JoinJudgeRoomErrorBody]:
        """No credential. A bidder joins a judge room with its 6 character code and a display name and gets a session
        token. Only judge rooms: the code of any other auction answers exactly like an unknown code (404). Wrong codes
        are counted; 5 wrong codes lock a source address out for 15 minutes (429 ``judge_join_locked``). At most 20
        bidders join one room (429 ``judge_room_full``). An ended room answers 410.

        Args:
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/join"),
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeJoinRequest | ApiJudgeJoinRequestDict](body),
            decoder=async_json_decoder[ApiJudgeJoinResponse],
            error_mapper=join_judge_room_error_mapper,
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

    async def place_judge_bid(
        self,
        id_: str,
        body: ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ApiJudgeRoomsBidsResponse, PlaceJudgeBidErrorBody]:
        """Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the socket needs a
        browser ``Origin``; this route does not, and the socket rules are unchanged). Send the session token from ``POST
        /api/judge/join`` as a bearer token, after the bidder has a hold (``POST /api/judge/rooms/{id}/sim-hold``). The
        bid takes the same path as a socket bid: the per-bidder bid limit, the registered check and the auction engine
        all apply. ``amount`` is whole cents. ``mid`` is optional; send the same ``mid`` again to retry safely, the room
        answers with the original result and records nothing twice.

        A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with ``accepted: false`` and a
        ``reason``. Sending a ``mid`` again with a different ``amount`` is 409 ``conflict`` (``{error, code,
        message}``). Bids sent too fast are 429 ``rate_limited`` with ``Retry-After``. When the room cannot take the bid
        (``auction_full``, ``store_unavailable``, ``room_full``) the answer is 503. Only session tokens work here, and
        only for judge rooms: any other auction answers 404. A judge key is not needed on this route.

        Args:
            id_: Auction id.
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/judge/rooms/{id}/bids"),
            path_params=[param[str]("id", id_)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict](body),
            auth_scheme=self._auth.session_auth,
            decoder=async_json_decoder[ApiJudgeRoomsBidsResponse],
            error_mapper=place_judge_bid_error_mapper,
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
