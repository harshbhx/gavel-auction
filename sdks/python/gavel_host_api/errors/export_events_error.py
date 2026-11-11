from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

ExportEventsErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _ExportEventsError:
    def map(self, status_code: int, content: bytes) -> ExportEventsErrorBody:
        match status_code:
            case 401 | 403 | 404 | 405 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


export_events_error_mapper: Final[ErrorMapper[ExportEventsErrorBody]] = _ExportEventsError()
