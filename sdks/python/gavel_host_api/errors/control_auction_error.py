from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

ControlAuctionErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _ControlAuctionError:
    def map(self, status_code: int, content: bytes) -> ControlAuctionErrorBody:
        match status_code:
            case 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


control_auction_error_mapper: Final[ErrorMapper[ControlAuctionErrorBody]] = _ControlAuctionError()
