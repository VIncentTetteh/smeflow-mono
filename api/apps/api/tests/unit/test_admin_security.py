from types import SimpleNamespace

from starlette.requests import Request

from apps.api.modules.admin import router as admin_router


def make_request(*, client_host: str, forwarded_for: str | None = None) -> Request:
    headers = []
    if forwarded_for:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/admin/auth/login",
            "headers": headers,
            "client": (client_host, 443),
        }
    )


def test_admin_client_ip_ignores_forwarded_for_without_trusted_proxy(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        admin_router,
        "get_settings",
        lambda: SimpleNamespace(TRUSTED_PROXY_COUNT=0),
        raising=False,
    )

    request = make_request(client_host="10.0.0.5", forwarded_for="203.0.113.9")

    assert admin_router._get_client_ip(request) == "10.0.0.5"


def test_admin_client_ip_honors_forwarded_for_with_trusted_proxy(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        admin_router,
        "get_settings",
        lambda: SimpleNamespace(TRUSTED_PROXY_COUNT=1),
        raising=False,
    )

    request = make_request(client_host="10.0.0.5", forwarded_for="203.0.113.9, 10.0.0.5")

    assert admin_router._get_client_ip(request) == "203.0.113.9"
