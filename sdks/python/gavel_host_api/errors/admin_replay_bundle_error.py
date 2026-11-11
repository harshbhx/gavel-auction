from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.unions.error5 import Error5

AdminReplayBundleErrorBody: TypeAlias = Error5 | RawError


@dataclass(frozen=True, slots=True)
class _AdminReplayBundleError:
    def map(self, status_code: int, content: bytes) -> AdminReplayBundleErrorBody:
        match status_code:
            case 400 | 401 | 404 | 405 | 409 | 429 | 500:
                return decode_json[Error5](content)
            case _:
                return RawError(status_code, content)


admin_replay_bundle_error_mapper: Final[ErrorMapper[AdminReplayBundleErrorBody]] = _AdminReplayBundleError()
