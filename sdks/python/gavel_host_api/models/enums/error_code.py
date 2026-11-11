from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class ErrorCode(str, Enum):
    """Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount; 401
    unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used, closed, already_leading,
    lot_not_open, unconfirmed, already_bid, auction_paused, conflict, host_fenced; 422 below_increment, over_ceiling,
    below_reserve, not_higher_than_own_max, limit_exceeded (these arise on the socket, in ``bid_rejected``); 429
    rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable."""

    BAD_MESSAGE = "bad_message"
    UNSUPPORTED_VERSION = "unsupported_version"
    NOT_JOINED = "not_joined"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    INVITE_USED = "invite_used"
    RATE_LIMITED = "rate_limited"
    ROOM_FULL = "room_full"
    AUCTION_FULL = "auction_full"
    ROOM_CAP = "room_cap"
    UNREGISTERED = "unregistered"
    BELOW_INCREMENT = "below_increment"
    OVER_CEILING = "over_ceiling"
    BELOW_RESERVE = "below_reserve"
    CLOSED = "closed"
    ALREADY_LEADING = "already_leading"
    BAD_AMOUNT = "bad_amount"
    LOT_NOT_OPEN = "lot_not_open"
    CEILING_REVOKED = "ceiling_revoked"
    UNCONFIRMED = "unconfirmed"
    NOT_HIGHER_THAN_OWN_MAX = "not_higher_than_own_max"
    ALREADY_BID = "already_bid"
    LIMIT_EXCEEDED = "limit_exceeded"
    AUCTION_PAUSED = "auction_paused"
    STORE_UNAVAILABLE = "store_unavailable"
    CONFLICT = "conflict"
    HOST_FENCED = "host_fenced"
    NOT_FOUND = "not_found"
    INTERNAL = "internal"

    __str__ = str.__str__


ErrorCodeOrStr: TypeAlias = Annotated[ErrorCode | str, open_enum_validator(ErrorCode)]
