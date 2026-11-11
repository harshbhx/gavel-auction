from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .enums.hold_status import HoldStatusOrStr


class ApiHoldsResponse(SdkBaseModel):
    hold_id: str = Field(alias="holdId")
    status: HoldStatusOrStr
    ceiling_cents: int = Field(alias="ceilingCents")


class ApiHoldsResponseDict(TypedDict):
    hold_id: str
    status: HoldStatusOrStr
    ceiling_cents: int
