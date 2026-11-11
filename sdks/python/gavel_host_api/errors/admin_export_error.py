from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

AdminExportErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _AdminExportError:
    def map(self, status_code: int, content: bytes) -> AdminExportErrorBody:
        match status_code:
            case 400 | 401 | 404 | 405 | 429 | 500 | 501:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


admin_export_error_mapper: Final[ErrorMapper[AdminExportErrorBody]] = _AdminExportError()
