import pytest

from apps.api.core.middleware import ContentLengthLimitMiddleware


async def ok_app(_scope, receive, send) -> None:
    while True:
        message = await receive()
        if message["type"] != "http.request" or not message.get("more_body"):
            break
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok", "more_body": False})


async def run_middleware(body: bytes, *, max_body_size: int, headers=None) -> list[dict]:
    sent: list[dict] = []
    consumed = False
    app = ContentLengthLimitMiddleware(ok_app, max_body_size=max_body_size)

    async def receive() -> dict:
        nonlocal consumed
        if consumed:
            return {"type": "http.request", "body": b"", "more_body": False}
        consumed = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict) -> None:
        sent.append(message)

    await app(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/sales",
            "headers": headers or [],
        },
        receive,
        send,
    )
    return sent


@pytest.mark.asyncio
async def test_content_length_header_rejects_oversized_payload() -> None:
    sent = await run_middleware(
        b"",
        max_body_size=3,
        headers=[(b"content-length", b"4")],
    )

    assert sent[0]["status"] == 413
    assert b"Request body too large" in sent[1]["body"]


@pytest.mark.asyncio
async def test_streamed_body_rejects_oversized_payload_without_header() -> None:
    sent = await run_middleware(b"abcd", max_body_size=3)

    assert sent[0]["status"] == 413
    assert all(message.get("status") != 200 for message in sent)
