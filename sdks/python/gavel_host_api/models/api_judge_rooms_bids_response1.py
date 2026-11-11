from __future__ import annotations

from typing import Literal

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeRoomsBidsResponse1(SdkBaseModel):
    accepted: Literal["False"] = "False"
    pending: Literal["True"] = "True"
    mid: str


class ApiJudgeRoomsBidsResponse1Dict(TypedDict):
    accepted: Literal["False"]
    pending: Literal["True"]
    mid: str
