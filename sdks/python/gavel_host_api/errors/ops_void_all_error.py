from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

OpsVoidAllErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _OpsVoidAllError:
    def map(self, status_code: int, content: bytes) -> OpsVoidAllErrorBody:
        match status_code:
            case 401 | 404 | 405 | 409 | 429:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


ops_void_all_error_mapper: Final[ErrorMapper[OpsVoidAllErrorBody]] = _OpsVoidAllError()
