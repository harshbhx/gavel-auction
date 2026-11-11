from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .step import Step, StepDict


class WarmupReportError(SdkBaseModel):
    ok: bool
    """True when every warm-up step succeeded."""

    elapsed_ms: int = Field(alias="elapsedMs")
    """Total time of the warm-up in milliseconds."""

    steps: list[Step]
    """One entry per warm-up step, in the order they ran."""


class WarmupReportErrorDict(TypedDict):
    ok: bool
    elapsed_ms: int
    steps: list[StepDict]
