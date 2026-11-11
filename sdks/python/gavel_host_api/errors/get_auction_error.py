from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

GetAuctionErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _GetAuctionError:
    def map(self, status_code: int, content: bytes) -> GetAuctionErrorBody:
        match status_code:
            case 404 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


get_auction_error_mapper: Final[ErrorMapper[GetAuctionErrorBody]] = _GetAuctionError()
