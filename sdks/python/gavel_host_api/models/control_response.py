from __future__ import annotations

from typing import Any, Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ControlResponse(SdkBaseModel):
    ok: Literal["True"] = "True"
    """Always true on success."""

    control_id: str = Field(alias="controlId")
    """The controlId you sent."""

    hammer: Optional[Any] = UNSET
    """The hammer frame, present when the control ended the lot."""


class ControlResponseDict(TypedDict):
    ok: Literal["True"]
    control_id: str
    hammer: NotRequired[Any]
