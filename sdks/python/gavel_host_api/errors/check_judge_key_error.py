from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

CheckJudgeKeyErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _CheckJudgeKeyError:
    def map(self, status_code: int, content: bytes) -> CheckJudgeKeyErrorBody:
        match status_code:
            case 401 | 404 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


check_judge_key_error_mapper: Final[ErrorMapper[CheckJudgeKeyErrorBody]] = _CheckJudgeKeyError()
