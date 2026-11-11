from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .enums.reason import ReasonOrStr


class Readyz503Error(SdkBaseModel):
    status: Literal["unavailable"] = "unavailable"
    reason: ReasonOrStr


class Readyz503ErrorDict(TypedDict):
    status: Literal["unavailable"]
    reason: ReasonOrStr
