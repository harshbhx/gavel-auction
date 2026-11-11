from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

ApproveHoldErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _ApproveHoldError:
    def map(self, status_code: int, content: bytes) -> ApproveHoldErrorBody:
        match status_code:
            case 400 | 401 | 404 | 409 | 413 | 415 | 429 | 500 | 503:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


approve_hold_error_mapper: Final[ErrorMapper[ApproveHoldErrorBody]] = _ApproveHoldError()
