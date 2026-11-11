from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class Error(SdkBaseModel):
    error: Optional[str] = UNSET
    """Stable code (hold, judge and operator routes)."""

    code: str
    """Stable code (core and judge routes). One of ErrorCode."""

    message: str
    """Text for a person. Never contains a token or a stack trace."""

    detail: Optional[str] = UNSET
    """Optional extra text, for example the failing field path and reason."""


class ErrorDict(TypedDict):
    error: NotRequired[str]
    code: str
    message: str
    detail: NotRequired[str]
