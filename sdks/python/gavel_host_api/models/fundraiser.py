from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Fundraiser(SdkBaseModel):
    """Fundraiser goal, present only when one was set."""

    goal_cents: int = Field(alias="goalCents")
    """Goal in cents."""


class FundraiserDict(TypedDict):
    goal_cents: int
