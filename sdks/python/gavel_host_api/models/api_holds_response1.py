from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ApiHoldsResponse1(SdkBaseModel):
    hold_id: str = Field(alias="holdId")
    released: Literal["True"] = "True"


class ApiHoldsResponse1Dict(TypedDict):
    hold_id: str
    released: Literal["True"]
