from __future__ import annotations

from pydantic import Field
from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Hammer(SdkBaseModel):
    """Result of the lot, present once it was hammered."""

    winner_id: str | None = Field(alias="winnerId")
    """Bidder id of the winner, or null when the lot did not sell."""

    price: int
    """Money in integer US cents. There are no decimals anywhere in the API."""


class HammerDict(TypedDict):
    winner_id: str | None
    price: int
