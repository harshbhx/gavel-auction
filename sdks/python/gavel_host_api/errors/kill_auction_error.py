from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

KillAuctionErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _KillAuctionError:
    def map(self, status_code: int, content: bytes) -> KillAuctionErrorBody:
        match status_code:
            case 400 | 401 | 403 | 404 | 413 | 415 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


kill_auction_error_mapper: Final[ErrorMapper[KillAuctionErrorBody]] = _KillAuctionError()
