from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.readyz503_error1 import Readyz503Error1

GetReadinessErrorBody: TypeAlias = Readyz503Error1 | RawError


@dataclass(frozen=True, slots=True)
class _GetReadinessError:
    def map(self, status_code: int, content: bytes) -> GetReadinessErrorBody:
        match status_code:
            case 503:
                return decode_json[Readyz503Error1](content)
            case _:
                return RawError(status_code, content)


get_readiness_error_mapper: Final[ErrorMapper[GetReadinessErrorBody]] = _GetReadinessError()
