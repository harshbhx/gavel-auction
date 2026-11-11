from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.hold_scope import HoldScopeOrStr
from .enums.mode import Mode, ModeOrStr
from .increment_ladder import IncrementLadder, IncrementLadderDict


class AuctionConfig(SdkBaseModel):
    """Settings of one auction. Amounts are in cents, durations in milliseconds."""

    mode: ModeOrStr = Mode.ENGLISH
    """Bidding mode. Defaults to english."""

    currency: Literal["USD"] = "USD"
    """Currency of every amount. Only USD is accepted."""

    reserve: int
    """Reserve price in cents (at least 100)."""

    min_increment: int = Field(alias="minIncrement")
    """Smallest raise in cents."""

    end_ts: int = Field(alias="endTs")
    """Milliseconds since the Unix epoch."""

    soft_close_window_ms: int = Field(alias="softCloseWindowMs")
    """A bid this close to the end extends the lot."""

    soft_close_extension_ms: int = Field(alias="softCloseExtensionMs")
    """How long a soft close extends the lot, in milliseconds."""

    max_extensions: int = Field(alias="maxExtensions")
    """Most times the lot can be extended by soft close."""

    ceiling_presets: list[int] = Field(alias="ceilingPresets")
    """Strictly ascending ceiling amounts in cents, none below the reserve."""

    confirm_confidence_threshold: float = Field(alias="confirmConfidenceThreshold")
    """Spoken bids below this confidence need the bidder to confirm."""

    auto_hammer_delay_ms: Optional[int] = Field(default=UNSET, alias="autoHammerDelayMs")
    """Milliseconds after closing begins before the host hammers the lot by itself. When absent, the auctioneer hammers
    by hand."""

    hold_scope: Optional[HoldScopeOrStr] = Field(default=UNSET, alias="holdScope")
    """Whether one hold covers the whole event or a single lot. The engine default is event."""

    increment_ladder: Optional[list[IncrementLadder]] = Field(default=UNSET, alias="incrementLadder")
    """Tiered increments. Must start at fromCents 0 and strictly ascend."""


class AuctionConfigDict(TypedDict):
    mode: NotRequired[ModeOrStr]
    currency: Literal["USD"]
    reserve: int
    min_increment: int
    end_ts: int
    soft_close_window_ms: int
    soft_close_extension_ms: int
    max_extensions: int
    ceiling_presets: list[int]
    confirm_confidence_threshold: float
    auto_hammer_delay_ms: NotRequired[int]
    hold_scope: NotRequired[HoldScopeOrStr]
    increment_ladder: NotRequired[list[IncrementLadderDict]]
