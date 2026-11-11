from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ApiJudgeRoomsBidsRequest(SdkBaseModel):
    amount: int
    """Bid in cents."""

    mid: Optional[str] = UNSET
    """Optional message id (ULID) that makes a retry safe."""


class ApiJudgeRoomsBidsRequestDict(TypedDict):
    amount: int
    mid: NotRequired[str]
