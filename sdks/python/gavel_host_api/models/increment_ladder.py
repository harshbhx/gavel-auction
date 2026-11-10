from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class IncrementLadder(SdkBaseModel):
    from_cents: int = Field(alias="fromCents")
    """Price in cents from which this increment applies."""

    increment_cents: int = Field(alias="incrementCents")
    """Smallest raise in cents at this price tier."""


class IncrementLadderDict(TypedDict):
    from_cents: int
    increment_cents: int
