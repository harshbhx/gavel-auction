from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class Error2(SdkBaseModel):
    error: str
    """Stable code (hold, judge and operator routes)."""

    code: Optional[str] = UNSET
    """Stable code (core and judge routes). One of ErrorCode."""

    message: Optional[str] = UNSET
    """Text for a person. Never contains a token or a stack trace."""

    detail: Optional[str] = UNSET
    """Optional extra text, for example the failing field path and reason."""


class Error2Dict(TypedDict):
    error: str
    code: NotRequired[str]
    message: NotRequired[str]
    detail: NotRequired[str]
