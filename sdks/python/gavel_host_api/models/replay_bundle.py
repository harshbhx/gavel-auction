from __future__ import annotations

from typing import Any

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ReplayBundle(SdkBaseModel):
    """A verifiable export of the ledger (``packages/shared/src/replay-bundle.ts``). Hash with ``verifyPublicExport``
    and compare ``headHash``."""

    version: int
    """Version of the bundle format."""

    export_version: int = Field(alias="exportVersion")
    """Version of the export rules used to build the bundle."""

    auction_id: str = Field(alias="auctionId")
    """Id of the exported auction."""

    generated_at: int = Field(alias="generatedAt")
    """Milliseconds since the Unix epoch."""

    count: int
    """Number of events; equals the last event seq."""

    head_hash: str | None = Field(alias="headHash")
    """Hash of the last public event, or null for an empty ledger."""

    closed: Optional[bool] = UNSET
    """True when the last event closes the auction and names the event before it."""

    events: list[Any]
    """The public events in order, one object per event."""


class ReplayBundleDict(TypedDict):
    version: int
    export_version: int
    auction_id: str
    generated_at: int
    count: int
    head_hash: str | None
    closed: NotRequired[bool]
    events: list[Any]
