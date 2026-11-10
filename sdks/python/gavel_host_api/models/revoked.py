from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Revoked(SdkBaseModel):
    revoked: Literal["True"] = "True"


class RevokedDict(TypedDict):
    revoked: Literal["True"]
