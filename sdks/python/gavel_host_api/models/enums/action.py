from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Action(str, Enum):
    """The control to apply."""

    OPEN = "open"
    PAUSE = "pause"
    RESUME = "resume"
    EXTEND = "extend"
    HAMMER = "hammer"

    __str__ = str.__str__


ActionOrStr: TypeAlias = Annotated[Action | str, open_enum_validator(Action)]
