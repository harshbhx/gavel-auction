from __future__ import annotations

from typing import Literal

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .room_snapshot import RoomSnapshot, RoomSnapshotDict


class StateFrame(SdkBaseModel):
    """The ``state`` frame of the WebSocket protocol, returned over HTTP."""

    v: Literal[1] = 1
    """Protocol version of the frame."""

    t: Literal["state"] = "state"
    """Frame type. Always state."""

    seq: Optional[int] = UNSET
    """Sequence number of the last event the snapshot includes."""

    snapshot: RoomSnapshot
    """Room state for one viewer. Fields not listed here may appear; clients must ignore what they do not know. Private
    fields (``you``, ``yourHold``, ceilings) appear only for the bidder they belong to."""


class StateFrameDict(TypedDict):
    v: Literal[1]
    t: Literal["state"]
    seq: NotRequired[int]
    snapshot: RoomSnapshotDict
