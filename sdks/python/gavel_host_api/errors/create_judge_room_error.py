from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

CreateJudgeRoomErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _CreateJudgeRoomError:
    def map(self, status_code: int, content: bytes) -> CreateJudgeRoomErrorBody:
        match status_code:
            case 400 | 401 | 404 | 413 | 415 | 429 | 500 | 503:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


create_judge_room_error_mapper: Final[ErrorMapper[CreateJudgeRoomErrorBody]] = _CreateJudgeRoomError()
