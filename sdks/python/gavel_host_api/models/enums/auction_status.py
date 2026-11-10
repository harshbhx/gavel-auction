from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class AuctionStatus(str, Enum):
    """Lifecycle state of the auction, from SCHEDULED to DONE."""

    SCHEDULED = "SCHEDULED"
    OPEN = "OPEN"
    PAUSED = "PAUSED"
    CLOSING = "CLOSING"
    SETTLING = "SETTLING"
    DONE = "DONE"

    __str__ = str.__str__


AuctionStatusOrStr: TypeAlias = Annotated[AuctionStatus | str, open_enum_validator(AuctionStatus)]
