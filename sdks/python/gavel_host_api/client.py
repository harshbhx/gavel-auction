from __future__ import annotations

from functools import cached_property
from types import TracebackType

from typing_extensions import Self

from .apis.auctions import Auctions
from .apis.bidding_access import BiddingAccess
from .apis.control import Control
from .apis.export import Export
from .apis.health import Health
from .apis.holds import Holds
from .apis.judge_rooms import JudgeRooms
from .apis.operator import Operator
from .apis.read import Read
from .apis.receipts import Receipts
from .auth import AuthSchemes
from .base_client import DEFAULT_TIMEOUT, BaseGavelHostApiClient
from .core import (
    OPERATING_SYSTEM,
    PYTHON_RUNTIME,
    ApiKeyHeaderScheme,
    BearerAuthScheme,
    HttpClient,
    Httpx2Client,
    LoggingOptionsOrDict,
    RawClient,
    RetryOptionsOrDict,
    no_auth,
    param,
)
from .server.environment import Environment


class GavelHostApiClient(BaseGavelHostApiClient[RawClient]):
    def __init__(
        self,
        *,
        environment: Environment = "production",
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        retry_options: int | RetryOptionsOrDict | None = None,
        logging_options: LoggingOptionsOrDict | None = None,
        custom_http_client: HttpClient | None = None,
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
        self._raw_client = RawClient(
            http_client=custom_http_client if custom_http_client is not None else Httpx2Client(timeout=timeout),
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
        self._auth = AuthSchemes(
            admin_key=ApiKeyHeaderScheme("X-Admin-Key", admin_key) if admin_key is not None else no_auth,
            auctioneer_auth=BearerAuthScheme(auctioneer_auth) if auctioneer_auth is not None else no_auth,
            screen_auth=BearerAuthScheme(screen_auth) if screen_auth is not None else no_auth,
            reviewer_auth=BearerAuthScheme(reviewer_auth) if reviewer_auth is not None else no_auth,
            judge_key=ApiKeyHeaderScheme("X-Judge-Key", judge_key) if judge_key is not None else no_auth,
            session_auth=BearerAuthScheme(session_auth) if session_auth is not None else no_auth,
            receipt_auth=BearerAuthScheme(receipt_auth) if receipt_auth is not None else no_auth,
        )

    @cached_property
    def auctions(self) -> Auctions:
        return Auctions(self._raw_client, self._server, self._auth)

    @cached_property
    def bidding_access(self) -> BiddingAccess:
        return BiddingAccess(self._raw_client, self._server, self._auth)

    @cached_property
    def control(self) -> Control:
        return Control(self._raw_client, self._server, self._auth)

    @cached_property
    def export(self) -> Export:
        return Export(self._raw_client, self._server, self._auth)

    @cached_property
    def health(self) -> Health:
        return Health(self._raw_client, self._server)

    @cached_property
    def holds(self) -> Holds:
        return Holds(self._raw_client, self._server, self._auth)

    @cached_property
    def judge_rooms(self) -> JudgeRooms:
        return JudgeRooms(self._raw_client, self._server, self._auth)

    @cached_property
    def operator(self) -> Operator:
        return Operator(self._raw_client, self._server, self._auth)

    @cached_property
    def read(self) -> Read:
        return Read(self._raw_client, self._server, self._auth)

    @cached_property
    def receipts(self) -> Receipts:
        return Receipts(self._raw_client, self._server, self._auth)

    def close(self) -> None:
        self._raw_client.http_client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, exc_tb: TracebackType | None
    ) -> None:
        self.close()


Client = GavelHostApiClient
