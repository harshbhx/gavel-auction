from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

GetJudgeCapabilitiesErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _GetJudgeCapabilitiesError:
    def map(self, status_code: int, content: bytes) -> GetJudgeCapabilitiesErrorBody:
        match status_code:
            case 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


get_judge_capabilities_error_mapper: Final[ErrorMapper[GetJudgeCapabilitiesErrorBody]] = _GetJudgeCapabilitiesError()
