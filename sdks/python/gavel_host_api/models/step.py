from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Step(SdkBaseModel):
    name: str
    """Name of the warm-up step."""

    ok: bool
    """True when this step succeeded."""

    ms: int
    """Time this step took in milliseconds."""


class StepDict(TypedDict):
    name: str
    ok: bool
    ms: int
