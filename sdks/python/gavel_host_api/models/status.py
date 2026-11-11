from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Status(SdkBaseModel):
    status: Literal["ok"] = "ok"
    """Always ``ok`` when the host answers."""


class StatusDict(TypedDict):
    status: Literal["ok"]
