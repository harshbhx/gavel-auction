from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.api_judge_rooms_bids_response21 import ApiJudgeRoomsBidsResponse21
from ..models.unions.error5 import Error5

PlaceJudgeBidErrorBody: TypeAlias = Error5 | ApiJudgeRoomsBidsResponse21 | RawError


@dataclass(frozen=True, slots=True)
class _PlaceJudgeBidError:
    def map(self, status_code: int, content: bytes) -> PlaceJudgeBidErrorBody:
        match status_code:
            case 400 | 401 | 403 | 404 | 410 | 413 | 415 | 429 | 500 | 503:
                return decode_json[Error5](content)
            case 409:
                return decode_json[ApiJudgeRoomsBidsResponse21](content)
            case _:
                return RawError(status_code, content)


place_judge_bid_error_mapper: Final[ErrorMapper[PlaceJudgeBidErrorBody]] = _PlaceJudgeBidError()
