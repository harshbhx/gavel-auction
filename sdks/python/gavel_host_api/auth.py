from __future__ import annotations

from dataclasses import dataclass

from .core import AsyncAuthScheme, AuthScheme


@dataclass(frozen=True, slots=True, kw_only=True)
class AuthSchemes:
    admin_key: AuthScheme
    auctioneer_auth: AuthScheme
    screen_auth: AuthScheme
    reviewer_auth: AuthScheme
    judge_key: AuthScheme
    session_auth: AuthScheme
    receipt_auth: AuthScheme


@dataclass(frozen=True, slots=True, kw_only=True)
class AsyncAuthSchemes:
    admin_key: AsyncAuthScheme
    auctioneer_auth: AsyncAuthScheme
    screen_auth: AsyncAuthScheme
    reviewer_auth: AsyncAuthScheme
    judge_key: AsyncAuthScheme
    session_auth: AsyncAuthScheme
    receipt_auth: AsyncAuthScheme
