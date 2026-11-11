from __future__ import annotations

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class RoomEvent(SdkBaseModel):
    """One logged event. ``seq`` is always there. The other fields depend on ``type`` (``auction_created``,
    ``bidder_registered``, ``bid_accepted``, ``control``, ``state_changed``, ``hammered`` and others); a screen sees
    only ``seq`` for non-public types."""

    seq: int
    """Position of the event in the ledger, starting at 1."""

    type_: Optional[str] = Field(default=UNSET, alias="type")
    """Event type, for example auction_created or bid_accepted. Absent for non-public events seen by a screen."""


class RoomEventDict(TypedDict):
    seq: int
    type_: NotRequired[str]
