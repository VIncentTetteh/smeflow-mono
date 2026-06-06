"""
Middleware stack (applied outermost-first in main.py):
  1. SecurityHeadersMiddleware    — inject security response headers
  2. ContentLengthLimitMiddleware — reject oversized request bodies (default 1 MB)
  3. RequestContextMiddleware     — attach request_id + structured logging context
  4. TenantMiddleware             — inject business_id / user_id from JWT into request state
  5. RateLimitMiddleware          — per-phone / per-IP velocity limiting via slowapi

NOTE: All middlewares are implemented as pure ASGI middleware (not BaseHTTPMiddleware).
BaseHTTPMiddleware runs the route in a background task and returns the response before
generator-based dependencies (like get_db()) have finished their cleanup, meaning
`await session.commit()` can be deferred or skipped entirely if the task is cancelled.
Pure ASGI middleware calls `await self.app(scope, receive, send)` inline, so the full
request lifecycle — including all dependency cleanup and session commits — completes
before the middleware returns.
"""

import json
import time
import uuid

import structlog
from fastapi import Request
from jose import JWTError
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from apps.api.core.config import get_settings
from apps.api.core.security import decode_token

settings = get_settings()
logger = structlog.get_logger()


# ── Rate Limiter (exported for use in routers) ────────────────────────────────
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.REDIS_URL,
    default_limits=["1000/hour"],
)


# ── Request Context ───────────────────────────────────────────────────────────
class RequestContextMiddleware:
    """
    Pure ASGI middleware — attaches request_id + start timer; logs on completion.
    Injects X-Request-ID and X-Response-Time response headers.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = str(uuid.uuid4())
        start_time = time.perf_counter()

        # Ensure scope["state"] exists (Starlette initialises it, but be safe)
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id
        scope["state"]["start_time"] = start_time

        request = Request(scope)
        structlog.contextvars.clear_contextvars()
        traceparent = request.headers.get("traceparent")
        if traceparent:
            parts = traceparent.split("-")
            trace_id = parts[1] if len(parts) >= 2 else request_id
        else:
            trace_id = request_id
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            trace_id=trace_id,
            method=request.method,
            path=request.url.path,
        )

        status_code: int = 500

        async def send_with_headers(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                # Inject tracing headers into the response
                headers = MutableHeaders(scope=message)
                headers.append("X-Request-ID", request_id)
                headers.append("X-Trace-ID", trace_id)
            await send(message)

        # cleanup (session.commit, etc.) — before returning here.
        await self.app(scope, receive, send_with_headers)

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.info(
            "request.completed",
            status_code=status_code,
            duration_ms=duration_ms,
        )


# ── Tenant Injection ──────────────────────────────────────────────────────────
class TenantMiddleware:
    """
    Pure ASGI middleware — decodes JWT from Authorization header and injects
    into scope["state"]:
      - user_id
      - business_id
      - role
      - token_scope
      - lender_id
    Endpoints access these via the Depends() factories in dependencies.py.
    """

    SKIP_PATHS = {
        "/api/v1/auth/otp/request",
        "/api/v1/auth/otp/verify",
        "/api/v1/auth/refresh",
        "/api/v1/ussd/callback",  # Hubtel/Wigal webhook — no JWT
        "/api/docs",
        "/api/redoc",
        "/api/openapi.json",
        "/health",
        "/ready",
        "/metrics",
    }

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            scope.setdefault("state", {})
            state = scope["state"]

            # Initialise to safe defaults
            state["user_id"] = None
            state["business_id"] = None
            state["role"] = None
            state["token_scope"] = None
            state["lender_id"] = None

            path = scope.get("path", "")
            if path not in self.SKIP_PATHS:
                token = self._extract_token(scope)
                if token:
                    try:
                        payload = decode_token(token)
                        token_scope = payload.get("scope")
                        if token_scope == "lender":
                            state["token_scope"] = "lender"
                            state["lender_id"] = payload.get("lender_id")
                            structlog.contextvars.bind_contextvars(
                                lender_id=state["lender_id"],
                            )
                        elif payload.get("type") == "access":
                            state["token_scope"] = "user"
                            state["user_id"] = payload.get("sub")
                            state["business_id"] = payload.get("business_id")
                            state["role"] = payload.get("role", "owner")
                            structlog.contextvars.bind_contextvars(
                                user_id=state["user_id"],
                                business_id=state["business_id"],
                            )
                    except JWTError:
                        pass  # Individual endpoints enforce auth via Depends()

        await self.app(scope, receive, send)

    @staticmethod
    def _extract_token(scope: Scope) -> str | None:
        for name, value in scope.get("headers", []):
            if name.lower() == b"authorization":
                auth = value.decode("latin-1")
                if auth.startswith("Bearer "):
                    return auth[7:]
        return None


# ── Content-Length limit ──────────────────────────────────────────────────────


class ContentLengthLimitMiddleware:
    """
    Reject requests whose body exceeds MAX_REQUEST_BODY_BYTES.

    Default: 1 MB (1_048_576 bytes).  Configurable via MAX_REQUEST_BODY_SIZE
    environment variable (bytes).

    This prevents:
      - Memory exhaustion from giant JSON payloads
      - Slow-loris style body flooding
      - Accidental oversized file uploads to JSON endpoints

    Requests without a Content-Length header are capped by wrapping receive()
    and counting streamed bytes.
    """

    _DEFAULT_MAX = 1_048_576  # 1 MiB

    def __init__(self, app: ASGIApp, max_body_size: int | None = None) -> None:
        self.app = app
        self.max_size = max_body_size or int(
            getattr(settings, "MAX_REQUEST_BODY_BYTES", self._DEFAULT_MAX)
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            rejected = False
            rejection_sent = False

            async def reject() -> None:
                nonlocal rejection_sent
                if rejection_sent:
                    return
                rejection_sent = True
                body = json.dumps(
                    {
                        "detail": (
                            f"Request body too large. "
                            f"Maximum allowed size is {self.max_size} bytes."
                        )
                    }
                ).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body, "more_body": False})

            for name, value in scope.get("headers", []):
                if name.lower() == b"content-length":
                    try:
                        length = int(value)
                    except ValueError:
                        length = 0
                    if length > self.max_size:
                        await reject()
                        return

            seen = 0

            async def limited_receive() -> Message:
                nonlocal rejected, seen
                message = await receive()
                if message["type"] == "http.request":
                    seen += len(message.get("body", b""))
                    if seen > self.max_size:
                        rejected = True
                        await reject()
                        return {"type": "http.disconnect"}
                return message

            async def send_unless_rejected(message: Message) -> None:
                if rejected:
                    return
                await send(message)

            await self.app(scope, limited_receive, send_unless_rejected)
            return

        await self.app(scope, receive, send)


# ── Security response headers ─────────────────────────────────────────────────


class SecurityHeadersMiddleware:
    """
    Inject standard security headers into every HTTP response.

    Headers added:
      X-Content-Type-Options: nosniff
          Prevents browsers from MIME-sniffing the response away from the
          declared Content-Type.

      X-Frame-Options: DENY
          Blocks the API from being embedded in an iframe (clickjacking).

      X-XSS-Protection: 0
          Modern browsers use CSP; the legacy XSS auditor is disabled to
          avoid triggering false-positive blocks.

      Referrer-Policy: strict-origin-when-cross-origin
          Limits the Referer header to the origin only for cross-origin requests.

      Permissions-Policy: geolocation=(), microphone=(), camera=()
          Disables powerful browser features the API doesn't need.

      Strict-Transport-Security: max-age=63072000; includeSubDomains
          Only injected in production (APP_ENV=production) to avoid breaking
          local HTTP development.
    """

    _HEADERS = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"x-xss-protection", b"0"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"permissions-policy", b"geolocation=(), microphone=(), camera=()"),
    ]
    _HSTS = (
        b"strict-transport-security",
        b"max-age=63072000; includeSubDomains",
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._inject_hsts = settings.APP_ENV == "production"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_security_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self._HEADERS:
                    headers.append(name.decode(), value.decode())
                if self._inject_hsts:
                    headers.append(self._HSTS[0].decode(), self._HSTS[1].decode())
            await send(message)

        await self.app(scope, receive, send_with_security_headers)
