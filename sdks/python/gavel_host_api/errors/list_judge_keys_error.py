from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

ListJudgeKeysErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _ListJudgeKeysError:
    def map(self, status_code: int, content: bytes) -> ListJudgeKeysErrorBody:
        match status_code:
            case 401 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


list_judge_keys_error_mapper: Final[ErrorMapper[ListJudgeKeysErrorBody]] = _ListJudgeKeysError()
