from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5
from ..models.warmup_report import WarmupReport

WarmupErrorBody: TypeAlias = Error5 | WarmupReport | RawError


@dataclass(frozen=True, slots=True)
class _WarmupError:
    def map(self, status_code: int, content: bytes) -> WarmupErrorBody:
        match status_code:
            case 429:
                return decode_json[Error5](content)
            case 503:
                return decode_json[WarmupReport](content)
            case _:
                return RawError(status_code, content)


warmup_error_mapper: Final[ErrorMapper[WarmupErrorBody]] = _WarmupError()
