"""In-memory fake of the PayPal authorize/capture/void/reauthorize slice GAVEL needs.
Modelled on GAVEL-PLAN facts: honor period 3d, validity 29d, partial capture with
final_capture, over-capture cap (min(115%, +$75)), reauthorize day 4..29,
PayPal-Request-Id idempotency, webhooks. Amounts in cents. NOT the real API.
Where behaviour is [assumed] (error names, void-after-void) it is marked.
"""
import random
from dataclasses import dataclass, field

DAY = 86400.0


class Clock:
    def __init__(self, t=0.0): self.t = t
    def now(self): return self.t
    def advance(self, s): self.t += s


class PayPalError(Exception):
    def __init__(self, status, name):
        super().__init__(f"{status} {name}")
        self.status, self.name = status, name


class Timeout(Exception):
    """Client saw no response (the call may or may not have been applied)."""


@dataclass
class Auth:
    id: str
    payer: str
    hold: int
    start: float
    status: str = "CREATED"      # CREATED, PARTIALLY_CAPTURED, CAPTURED, VOIDED, EXPIRED
    captures: list = field(default_factory=list)   # [(capture_id, amount, final, request_id)]
    void_effects: int = 0
    reauths: int = 0

    @property
    def captured(self): return sum(c[1] for c in self.captures)


class FakePayPal:
    def __init__(self, clock=None, honor=3 * DAY, validity=29 * DAY, after_honor_capture="ok"):
        self.clock = clock or Clock()
        self.honor, self.validity = honor, validity
        self.after_honor_capture = after_honor_capture  # "ok" | "fail"
        self.auths: dict[str, Auth] = {}
        self.idem: dict[tuple, tuple] = {}
        self.events: list[dict] = []      # emitted webhook events (outbox)
        self.calls: list[tuple] = []      # (op, auth_id) audit of API calls reaching the server
        self._n = 0
        self._inject: list[dict] = []

    # ---------- failure injection
    def inject(self, op, kind, auth_id=None, times=1):
        """kind: timeout_after_success | timeout_before | http500 | capture_declined"""
        self._inject.append(dict(op=op, kind=kind, auth_id=auth_id, times=times))

    def _take(self, op, auth_id):
        for f in self._inject:
            if f["op"] == op and f["auth_id"] in (None, auth_id) and f["times"] > 0:
                f["times"] -= 1
                return f["kind"]
        return None

    def forget_idempotency(self):
        self.idem.clear()

    # ---------- internals
    def _id(self, p):
        self._n += 1
        return f"{p}-{self._n}"

    def _emit(self, typ, **res):
        self.events.append({"id": self._id("WH"), "event_type": typ, "resource": res})

    def _refresh(self, a: Auth):
        if a.status in ("CREATED", "PARTIALLY_CAPTURED") and self.clock.now() - a.start > self.validity:
            if a.status == "CREATED" or not self._final(a):
                a.status = "EXPIRED"
                self._emit("PAYMENT.AUTHORIZATION.VOIDED", auth_id=a.id, reason="expired")

    @staticmethod
    def _final(a): return any(c[2] for c in a.captures)

    def _get(self, auth_id) -> Auth:
        a = self.auths.get(auth_id)
        if not a:
            raise PayPalError(404, "RESOURCE_NOT_FOUND")
        self._refresh(a)
        return a

    def _cap_limit(self, hold):
        return hold + min(hold * 15 // 100, 7500)

    def _run(self, op, auth_id, req_id, params, fn):
        self.calls.append((op, auth_id))
        kind = self._take(op, auth_id)
        if kind == "timeout_before":
            raise Timeout(op)
        if kind == "http500":
            raise PayPalError(500, "INTERNAL_SERVICE_ERROR")
        key = (op, auth_id, req_id) if req_id else None
        if key and key in self.idem:
            fp, res = self.idem[key]
            if fp != params:
                raise PayPalError(422, "DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS")
            if kind == "timeout_after_success":
                raise Timeout(op)
            return res
        if kind == "capture_declined":
            raise PayPalError(422, "INSTRUMENT_DECLINED")
        res = fn()
        if key:
            self.idem[key] = (params, res)
        if kind == "timeout_after_success":
            raise Timeout(op)
        return res

    # ---------- API
    def create_authorization(self, payer, amount):
        a = Auth(self._id("AUTH"), payer, amount, self.clock.now())
        self.auths[a.id] = a
        return {"id": a.id, "status": "CREATED", "amount": amount}

    def get_authorization(self, auth_id):
        a = self._get(auth_id)
        return {"id": a.id, "status": a.status, "hold": a.hold, "captured": a.captured,
                "capture_request_ids": [c[3] for c in a.captures]}

    def capture(self, auth_id, amount, final_capture=True, request_id=None):
        def fn():
            a = self._get(auth_id)
            if a.status == "VOIDED": raise PayPalError(422, "AUTHORIZATION_VOIDED")
            if a.status == "EXPIRED": raise PayPalError(422, "AUTHORIZATION_EXPIRED")  # [assumed name]
            if a.status == "CAPTURED" or self._final(a): raise PayPalError(422, "AUTHORIZATION_ALREADY_CAPTURED")
            if amount <= 0: raise PayPalError(400, "INVALID_AMOUNT")
            if a.captured + amount > self._cap_limit(a.hold): raise PayPalError(422, "CAPTURE_AMOUNT_EXCEEDS_LIMIT")
            if self.clock.now() - a.start > self.honor and self.after_honor_capture == "fail":
                raise PayPalError(422, "AUTHORIZATION_NOT_HONORED_AFTER_HONOR_PERIOD")
            cid = self._id("CAP")
            a.captures.append((cid, amount, bool(final_capture), request_id))
            a.status = "CAPTURED" if final_capture else "PARTIALLY_CAPTURED"
            self._emit("PAYMENT.CAPTURE.COMPLETED", auth_id=a.id, capture_id=cid, amount=amount)
            return {"id": cid, "status": "COMPLETED", "amount": amount, "final_capture": bool(final_capture)}
        return self._run("capture", auth_id, request_id, (amount, bool(final_capture)), fn)

    def void(self, auth_id, request_id=None):
        def fn():
            a = self._get(auth_id)
            if a.status == "VOIDED": raise PayPalError(422, "AUTHORIZATION_ALREADY_VOIDED")  # [assumed name]
            if a.status == "EXPIRED": raise PayPalError(422, "AUTHORIZATION_EXPIRED")
            if a.status == "CAPTURED" or self._final(a): raise PayPalError(422, "AUTHORIZATION_ALREADY_CAPTURED")
            a.status = "VOIDED"
            a.void_effects += 1
            self._emit("PAYMENT.AUTHORIZATION.VOIDED", auth_id=a.id, reason="void")
            return {"id": a.id, "status": "VOIDED"}
        return self._run("void", auth_id, request_id, (), fn)

    def reauthorize(self, auth_id, amount, request_id=None):
        def fn():
            a = self._get(auth_id)
            if a.status not in ("CREATED", "PARTIALLY_CAPTURED"): raise PayPalError(422, "REAUTHORIZATION_NOT_ALLOWED")
            age = self.clock.now() - a.start
            if age <= self.honor: raise PayPalError(422, "REAUTHORIZATION_TOO_EARLY")
            if amount > self._cap_limit(a.hold): raise PayPalError(422, "REAUTHORIZATION_AMOUNT_EXCEEDS_LIMIT")
            a.hold, a.start = amount, self.clock.now()
            a.reauths += 1
            return {"id": a.id, "status": a.status, "amount": amount}
        return self._run("reauthorize", auth_id, request_id, (amount,), fn)

    # ---------- housekeeping
    def sweep(self):
        for a in self.auths.values():
            self._refresh(a)

    def deliver(self, mode="fifo", duplicate=False, seed=0):
        """Return the outbox as the receiver would see it. mode: fifo | reverse | shuffle."""
        ev = list(self.events)
        if mode == "reverse": ev.reverse()
        elif mode == "shuffle": random.Random(seed).shuffle(ev)
        if duplicate: ev = ev + list(ev)
        if duplicate and mode == "shuffle": random.Random(seed + 1).shuffle(ev)
        return ev

    # ---------- invariants the fake enforces / can verify
    def check_invariants(self):
        for a in self.auths.values():
            self._refresh(a)
            assert a.captured <= self._cap_limit(a.hold), f"{a.id} captured above cap"
            assert sum(1 for c in a.captures if c[2]) <= 1, f"{a.id} >1 final capture"
            if self._final(a): assert a.captures[-1][2], f"{a.id} capture after final"
            assert a.void_effects <= 1, f"{a.id} voided twice"
            assert not (a.void_effects and a.captures), f"{a.id} voided AND captured"
            if a.status == "VOIDED": assert a.void_effects == 1
        return True

    def released(self, auth_id):
        """Funds returned to payer from this hold: whole hold if voided/expired, remainder if final capture."""
        a = self.auths[auth_id]
        self._refresh(a)
        if a.status in ("VOIDED", "EXPIRED"): return a.hold
        if self._final(a): return max(0, a.hold - a.captured)
        return 0  # still held
