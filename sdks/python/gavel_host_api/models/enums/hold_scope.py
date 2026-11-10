from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class HoldScope(str, Enum):
    """Whether one hold covers the whole event or a single lot. The engine default is event."""

    EVENT = "event"
    LOT = "lot"

    __str__ = str.__str__


HoldScopeOrStr: TypeAlias = Annotated[HoldScope | str, open_enum_validator(HoldScope)]
