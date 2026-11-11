from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

CreateInvitesErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _CreateInvitesError:
    def map(self, status_code: int, content: bytes) -> CreateInvitesErrorBody:
        match status_code:
            case 400 | 401 | 403 | 404 | 413 | 415 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


create_invites_error_mapper: Final[ErrorMapper[CreateInvitesErrorBody]] = _CreateInvitesError()
