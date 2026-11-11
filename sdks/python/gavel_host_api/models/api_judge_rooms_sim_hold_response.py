from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiJudgeRoomsSimHoldResponse(SdkBaseModel):
    hold_id: str = Field(alias="holdId")
    simulated: Literal["True"] = "True"
    ceiling_cents: int = Field(alias="ceilingCents")


class ApiJudgeRoomsSimHoldResponseDict(TypedDict):
    hold_id: str
    simulated: Literal["True"]
    ceiling_cents: int
