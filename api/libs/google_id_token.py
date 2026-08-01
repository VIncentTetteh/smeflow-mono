"""Google Sign-In id_token verification.

Verifies the JWT signature locally against Google's published JWKS (via the
google-auth library's cached-key verifier) rather than round-tripping to
Google's tokeninfo endpoint on every login.
"""

from __future__ import annotations

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from apps.api.core.config import get_settings

_VALID_ISSUERS = ("accounts.google.com", "https://accounts.google.com")

_google_request = google_requests.Request()


class InvalidGoogleTokenError(Exception):
    """Raised when a Google id_token fails signature, issuer, or audience checks."""


def verify_google_token(id_token_str: str) -> dict:
    """Verify a Google id_token and return its claims.

    Accepts tokens issued for any of the app's configured client IDs (iOS,
    Android, Web) — Google issues a different `aud` per platform client.

    Raises InvalidGoogleTokenError on any verification failure.
    """
    settings = get_settings()
    allowed_audiences = {
        client_id
        for client_id in (
            settings.GOOGLE_OAUTH_IOS_CLIENT_ID,
            settings.GOOGLE_OAUTH_ANDROID_CLIENT_ID,
            settings.GOOGLE_OAUTH_WEB_CLIENT_ID,
        )
        if client_id
    }
    if not allowed_audiences:
        raise InvalidGoogleTokenError("Google Sign-In is not configured")

    try:
        idinfo = google_id_token.verify_oauth2_token(id_token_str, _google_request)
    except Exception as exc:
        raise InvalidGoogleTokenError("Invalid or expired Google token") from exc

    if idinfo.get("iss") not in _VALID_ISSUERS:
        raise InvalidGoogleTokenError("Unexpected token issuer")
    if idinfo.get("aud") not in allowed_audiences:
        raise InvalidGoogleTokenError("Token was not issued for this app")
    if not idinfo.get("email_verified", False):
        raise InvalidGoogleTokenError("Google account email is not verified")

    return idinfo
