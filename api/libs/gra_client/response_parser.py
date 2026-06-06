"""
Parse and normalise GRA e-VAT API responses.

GRA can return different HTTP status codes and body shapes depending on:
  - Successful submission (201): includes a GRA reference number
  - Validation error (400/422): field-level error list
  - Auth error (401/403): token issue
  - Server error (5xx): retry candidate
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GRASubmissionResult:
    success: bool
    gra_ref: str | None  # Reference number issued by GRA on acceptance
    status: str  # "accepted" | "pending" | "rejected" | "error"
    message: str
    raw: dict  # Full response body for audit logging


def parse_submission_response(status_code: int, body: dict) -> GRASubmissionResult:
    """
    Normalise the HTTP response from POST /returns/vat.

    Expected success body (HTTP 201)::

        {
          "referenceNumber": "GRA-VAT-2025010001",
          "status": "ACCEPTED",
          "message": "Return submitted successfully."
        }

    Expected validation error body (HTTP 400/422)::

        {
          "status": "REJECTED",
          "errors": [{"field": "vatReturn.netVat", "message": "Value cannot be negative"}]
        }
    """
    if status_code in (200, 201, 202):
        gra_ref = body.get("referenceNumber") or body.get("reference") or body.get("ref")
        return GRASubmissionResult(
            success=True,
            gra_ref=gra_ref,
            status="accepted",
            message=body.get("message", "Accepted"),
            raw=body,
        )

    if status_code in (400, 422):
        errors = body.get("errors", [])
        detail = (
            "; ".join(e.get("message", str(e)) for e in errors)
            if errors
            else body.get("message", "Validation error")
        )
        return GRASubmissionResult(
            success=False,
            gra_ref=None,
            status="rejected",
            message=detail,
            raw=body,
        )

    if status_code in (401, 403):
        return GRASubmissionResult(
            success=False,
            gra_ref=None,
            status="error",
            message="GRA authentication failed — check GRA_API_KEY",
            raw=body,
        )

    # 5xx or unexpected
    return GRASubmissionResult(
        success=False,
        gra_ref=None,
        status="error",
        message=f"GRA server error (HTTP {status_code}): {body.get('message', 'Unknown')}",
        raw=body,
    )
