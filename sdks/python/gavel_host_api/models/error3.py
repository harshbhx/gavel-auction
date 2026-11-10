from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class Error3(SdkBaseModel):
    """The error body. ``message`` is always there. The stable code is in ``code`` on the core and judge routes and in
    ``error`` on the hold, judge and operator routes: read ``code ?? error``. 413 and 415 use ``bad_message``."""

    error: Optional[str] = UNSET
    """Stable code (hold, judge and operator routes)."""

    code: Optional[str] = UNSET
    """Stable code (core and judge routes). One of ErrorCode."""

    message: Optional[str] = UNSET
    """Text for a person. Never contains a token or a stack trace."""

    detail: Optional[str] = UNSET
    """Optional extra text, for example the failing field path and reason."""


class Error3Dict(TypedDict):
    error: NotRequired[str]
    code: NotRequired[str]
    message: NotRequired[str]
    detail: NotRequired[str]
