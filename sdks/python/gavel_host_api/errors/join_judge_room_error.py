from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

JoinJudgeRoomErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _JoinJudgeRoomError:
    def map(self, status_code: int, content: bytes) -> JoinJudgeRoomErrorBody:
        match status_code:
            case 400 | 404 | 410 | 413 | 415 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


join_judge_room_error_mapper: Final[ErrorMapper[JoinJudgeRoomErrorBody]] = _JoinJudgeRoomError()
