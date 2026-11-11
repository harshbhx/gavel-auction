from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiHoldsApproveResponse(SdkBaseModel):
    hold_id: str = Field(alias="holdId")
    status: Literal["HELD"] = "HELD"
    ceiling_cents: int = Field(alias="ceilingCents")


class ApiHoldsApproveResponseDict(TypedDict):
    hold_id: str
    status: Literal["HELD"]
    ceiling_cents: int
