from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

GetJudgeRoomLedgerErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _GetJudgeRoomLedgerError:
    def map(self, status_code: int, content: bytes) -> GetJudgeRoomLedgerErrorBody:
        match status_code:
            case 401 | 404 | 409 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


get_judge_room_ledger_error_mapper: Final[ErrorMapper[GetJudgeRoomLedgerErrorBody]] = _GetJudgeRoomLedgerError()
