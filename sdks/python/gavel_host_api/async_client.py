from __future__ import annotations

from functools import cached_property
from types import TracebackType

from typing_extensions import Self

from .apis.auctions import AsyncAuctions
from .apis.bidding_access import AsyncBiddingAccess
from .apis.control import AsyncControl
from .apis.export import AsyncExport
from .apis.health import AsyncHealth
from .apis.holds import AsyncHolds
from .apis.judge_rooms import AsyncJudgeRooms
from .apis.operator import AsyncOperator
from .apis.read import AsyncRead
from .apis.receipts import AsyncReceipts
from .auth import AsyncAuthSchemes
from .base_client import DEFAULT_TIMEOUT, BaseGavelHostApiClient
from .core import (
    OPERATING_SYSTEM,
    PYTHON_RUNTIME,
    ApiKeyHeaderScheme,
    AsyncHttpClient,
    AsyncHttpx2Client,
    AsyncRawClient,
    BearerAuthScheme,
    LoggingOptionsOrDict,
    RetryOptionsOrDict,
    no_auth,
    param,
)
from .server.environment import Environment


class AsyncGavelHostApiClient(BaseGavelHostApiClient[AsyncRawClient]):
    def __init__(
        self,
        *,
        environment: Environment = "production",
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        retry_options: int | RetryOptionsOrDict | None = None,
        logging_options: LoggingOptionsOrDict | None = None,
        custom_async_http_client: AsyncHttpClient | None = None,
        admin_key: str | None = None,
        auctioneer_auth: str | None = None,
        screen_auth: str | None = None,
        reviewer_auth: str | None = None,
        judge_key: str | None = None,
        session_auth: str | None = None,
        receipt_auth: str | None = None,
    ) -> None:
        super().__init__(
            environment=environment,
            base_url=base_url,
            timeout=timeout,
            retry_options=retry_options,
            logging_options=logging_options,
        )
        self._raw_client = AsyncRawClient(
            http_client=(
                custom_async_http_client if custom_async_http_client is not None else AsyncHttpx2Client(timeout=timeout)
            ),
            retry_options=self._retry_options,
            logging_options=self._logging_options,
            global_headers=[
                param[str]("User-Agent", "GavelHostApiClient/0.0.5 Python"),
                param[str]("X-APIMatic-Lang", "Python"),
                param[str]("X-APIMatic-Package-Version", "0.0.5"),
                param[str]("X-APIMatic-Gen-Version", "4.0.0"),
                param[str]("X-APIMatic-OS", OPERATING_SYSTEM),
                param[str]("X-APIMatic-Runtime", PYTHON_RUNTIME),
            ],
        )
        self._auth = AsyncAuthSchemes(
            admin_key=ApiKeyHeaderScheme("X-Admin-Key", admin_key) if admin_key is not None else no_auth,
            auctioneer_auth=BearerAuthScheme(auctioneer_auth) if auctioneer_auth is not None else no_auth,
            screen_auth=BearerAuthScheme(screen_auth) if screen_auth is not None else no_auth,
            reviewer_auth=BearerAuthScheme(reviewer_auth) if reviewer_auth is not None else no_auth,
            judge_key=ApiKeyHeaderScheme("X-Judge-Key", judge_key) if judge_key is not None else no_auth,
            session_auth=BearerAuthScheme(session_auth) if session_auth is not None else no_auth,
            receipt_auth=BearerAuthScheme(receipt_auth) if receipt_auth is not None else no_auth,
        )

    @cached_property
    def auctions(self) -> AsyncAuctions:
        return AsyncAuctions(self._raw_client, self._server, self._auth)

    @cached_property
    def bidding_access(self) -> AsyncBiddingAccess:
        return AsyncBiddingAccess(self._raw_client, self._server, self._auth)

    @cached_property
    def control(self) -> AsyncControl:
        return AsyncControl(self._raw_client, self._server, self._auth)

    @cached_property
    def export(self) -> AsyncExport:
        return AsyncExport(self._raw_client, self._server, self._auth)

    @cached_property
    def health(self) -> AsyncHealth:
        return AsyncHealth(self._raw_client, self._server)

    @cached_property
    def holds(self) -> AsyncHolds:
        return AsyncHolds(self._raw_client, self._server, self._auth)

    @cached_property
    def judge_rooms(self) -> AsyncJudgeRooms:
        return AsyncJudgeRooms(self._raw_client, self._server, self._auth)

    @cached_property
    def operator(self) -> AsyncOperator:
        return AsyncOperator(self._raw_client, self._server, self._auth)

    @cached_property
    def read(self) -> AsyncRead:
        return AsyncRead(self._raw_client, self._server, self._auth)

    @cached_property
    def receipts(self) -> AsyncReceipts:
        return AsyncReceipts(self._raw_client, self._server, self._auth)

    async def aclose(self) -> None:
        await self._raw_client.http_client.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, exc_tb: TracebackType | None
    ) -> None:
        await self.aclose()


AsyncClient = AsyncGavelHostApiClient
