from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .state import State, StateDict


class ApiAuctionsKillResponse(SdkBaseModel):
    ok: Literal["True"] = "True"
    control_id: Optional[str] = Field(default=UNSET, alias="controlId")
    state: State


class ApiAuctionsKillResponseDict(TypedDict):
    ok: Literal["True"]
    control_id: NotRequired[str]
    state: StateDict
