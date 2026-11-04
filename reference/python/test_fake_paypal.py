import pytest
from fake_paypal import FakePayPal, Clock, PayPalError, Timeout, DAY


def mk(**kw):
    c = Clock(); return FakePayPal(c, **kw), c


def test_partial_final_capture_releases_remainder():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    pp.capture(a, 600, True, "r1")
    g = pp.get_authorization(a); assert g["status"] == "CAPTURED" and g["captured"] == 600
    assert pp.released(a) == 400
    with pytest.raises(PayPalError): pp.capture(a, 100, True, "r2")      # nothing after final
    with pytest.raises(PayPalError): pp.void(a, "v")                      # cannot void captured
    pp.check_invariants()


def test_non_final_captures_accumulate_to_cap():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    pp.capture(a, 600, False, "r1"); pp.capture(a, 550, False, "r2")     # 1150 = 115% of 1000
    with pytest.raises(PayPalError) as e: pp.capture(a, 1, False, "r3")
    assert e.value.name == "CAPTURE_AMOUNT_EXCEEDS_LIMIT"
    pp.check_invariants()


def test_overcapture_cap_is_min_115pct_or_75_dollars():
    pp, c = mk(); a = pp.create_authorization("p", 100000)["id"]          # $1000: +$75 binds
    with pytest.raises(PayPalError): pp.capture(a, 107501, True, "x")
    pp.capture(a, 107500, True, "y")


def test_void_and_double_void():
    pp, c = mk(); a = pp.create_authorization("p", 500)["id"]
    pp.void(a, "v1")
    with pytest.raises(PayPalError) as e: pp.void(a, "v2")
    assert e.value.name == "AUTHORIZATION_ALREADY_VOIDED"
    assert pp.auths[a].void_effects == 1
    with pytest.raises(PayPalError) as e: pp.capture(a, 100, True, "c")
    assert e.value.name == "AUTHORIZATION_VOIDED"


def test_idempotent_capture_replay_and_param_mismatch():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    r1 = pp.capture(a, 300, True, "same"); r2 = pp.capture(a, 300, True, "same")
    assert r1 == r2 and len(pp.auths[a].captures) == 1
    assert len([e for e in pp.events if e["event_type"] == "PAYMENT.CAPTURE.COMPLETED"]) == 1
    with pytest.raises(PayPalError): pp.capture(a, 301, True, "same")


def test_timeout_after_success_then_retry_same_key_no_double():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    pp.inject("capture", "timeout_after_success")
    with pytest.raises(Timeout): pp.capture(a, 300, True, "k")
    assert pp.auths[a].captured == 300                                    # it DID happen
    pp.capture(a, 300, True, "k"); assert pp.auths[a].captured == 300


def test_timeout_before_means_not_applied():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    pp.inject("capture", "timeout_before")
    with pytest.raises(Timeout): pp.capture(a, 300, True, "k")
    assert pp.auths[a].captured == 0


def test_honor_and_validity_expiry():
    pp, c = mk(after_honor_capture="fail"); a = pp.create_authorization("p", 1000)["id"]
    c.advance(2 * DAY); pp.capture(a, 100, False, "in-honor")
    c.advance(2 * DAY)
    with pytest.raises(PayPalError) as e: pp.capture(a, 100, True, "late")
    assert "HONOR" in e.value.name
    pp2, c2 = mk(); b = pp2.create_authorization("p", 1000)["id"]
    c2.advance(10 * DAY); pp2.capture(b, 100, True, "late-ok")           # after honor still works by default
    pp3, c3 = mk(); d = pp3.create_authorization("p", 1000)["id"]
    c3.advance(30 * DAY)
    with pytest.raises(PayPalError) as e: pp3.capture(d, 100, True, "x")
    assert e.value.name == "AUTHORIZATION_EXPIRED"
    assert any(ev["event_type"] == "PAYMENT.AUTHORIZATION.VOIDED" for ev in pp3.events)
    assert pp3.released(d) == 1000


def test_reauthorize_window():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    with pytest.raises(PayPalError): pp.reauthorize(a, 1000, "r")          # day 0: too early
    c.advance(5 * DAY); pp.reauthorize(a, 1100, "r2")
    assert pp.auths[a].reauths == 1
    c.advance(26 * DAY)                                                   # 26d after reauth (<29): alive
    pp.capture(a, 1100, True, "c")
    pp.check_invariants()


def test_injected_decline_and_500():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]
    pp.inject("capture", "capture_declined")
    with pytest.raises(PayPalError) as e: pp.capture(a, 100, True, "k1")
    assert e.value.name == "INSTRUMENT_DECLINED" and pp.auths[a].captured == 0
    pp.inject("capture", "http500")
    with pytest.raises(PayPalError) as e: pp.capture(a, 100, True, "k2")
    assert e.value.status == 500


def test_webhook_duplicate_and_out_of_order_delivery():
    pp, c = mk(); a = pp.create_authorization("p", 1000)["id"]; b = pp.create_authorization("q", 1000)["id"]
    pp.capture(a, 100, True, "k"); pp.void(b, "v")
    assert len(pp.deliver("fifo")) == 2
    assert len(pp.deliver("shuffle", duplicate=True, seed=3)) == 4
    assert [e["id"] for e in pp.deliver("reverse")] == [e["id"] for e in pp.deliver("fifo")][::-1]
