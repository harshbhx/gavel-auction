from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ApiAuctionsKillRequest(SdkBaseModel):
    control_id: Optional[str] = Field(default=UNSET, alias="controlId")
    confirm: Literal["STOP"] = "STOP"


class ApiAuctionsKillRequestDict(TypedDict):
    control_id: NotRequired[str]
    confirm: Literal["STOP"]
