from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.action import ActionOrStr


class ControlRequest(SdkBaseModel):
    control_id: str = Field(alias="controlId")
    """Idempotency key you mint. The same id with the same action is a repeat."""

    action: ActionOrStr
    """The control to apply."""

    args: Optional[dict[str, float]] = UNSET
    """``extend`` needs ``extraMs`` (whole number, 1 to 600000). ``hammer`` needs ``closeNow: 1`` while the lot is
    open."""


class ControlRequestDict(TypedDict):
    control_id: str
    action: ActionOrStr
    args: NotRequired[dict[str, float]]
