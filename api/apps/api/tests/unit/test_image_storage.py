"""Unit tests for the local image-storage host-URL safety check.

Guards against Host header injection / stored URL poisoning: the local dev
media fallback used to trust Request.base_url unconditionally, so a spoofed
Host header would get persisted as a catalog item's public image_url and
served to every storefront visitor.
"""

from libs.image_storage import _safe_local_base_url


class _FakeSettings:
    APP_BASE_URL = "https://app.smeflow.com"


def test_trusts_localhost():
    assert _safe_local_base_url("http://localhost:8000", _FakeSettings()) == "http://localhost:8000"


def test_trusts_loopback_ip():
    assert _safe_local_base_url("http://127.0.0.1:8000", _FakeSettings()) == "http://127.0.0.1:8000"


def test_trusts_private_lan_ip():
    assert _safe_local_base_url("http://192.168.1.42:8000", _FakeSettings()) == "http://192.168.1.42:8000"


def test_trusts_ipv6_loopback():
    assert _safe_local_base_url("http://[::1]:8000", _FakeSettings()) == "http://[::1]:8000"


def test_falls_back_to_app_base_url_for_spoofed_host():
    """A request with Host: evil.com must never be persisted as the stored image URL."""
    assert _safe_local_base_url("http://evil.com", _FakeSettings()) == "https://app.smeflow.com"


def test_falls_back_for_public_ip():
    assert _safe_local_base_url("http://8.8.8.8:8000", _FakeSettings()) == "https://app.smeflow.com"


def test_rejects_prefix_spoofing_bypass():
    """Hostnames that merely start with an allowed prefix must still be rejected —
    a naive startswith("10.") or startswith("localhost") check would wrongly
    trust these."""
    assert _safe_local_base_url("http://10.evil.com", _FakeSettings()) == "https://app.smeflow.com"
    assert (
        _safe_local_base_url("http://localhost.evil.com", _FakeSettings())
        == "https://app.smeflow.com"
    )
    assert (
        _safe_local_base_url("http://127.0.0.1.evil.com", _FakeSettings())
        == "https://app.smeflow.com"
    )
