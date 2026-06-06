"""
Centralised exception hierarchy + FastAPI exception handlers.
All API errors follow the shape: {"error": {"code": str, "message": str, "details": any}}
"""

import re

import sqlalchemy.exc
import structlog
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


# ── Base ──────────────────────────────────────────────────────────────────────
class SMEFlowError(Exception):
    """Base exception for all application errors."""

    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: object = None,
    ) -> None:
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details
        super().__init__(message)


# ── Auth ──────────────────────────────────────────────────────────────────────
class UnauthorizedError(SMEFlowError):
    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(message, "UNAUTHORIZED", status.HTTP_401_UNAUTHORIZED)


class ForbiddenError(SMEFlowError):
    def __init__(self, message: str = "Insufficient permissions") -> None:
        super().__init__(message, "FORBIDDEN", status.HTTP_403_FORBIDDEN)


class InvalidOTPError(SMEFlowError):
    def __init__(self) -> None:
        super().__init__("Invalid or expired OTP", "INVALID_OTP", status.HTTP_400_BAD_REQUEST)


class OTPRateLimitError(SMEFlowError):
    def __init__(self) -> None:
        super().__init__(
            "Too many OTP requests. Try again in 5 minutes.",
            "OTP_RATE_LIMIT",
            status.HTTP_429_TOO_MANY_REQUESTS,
        )


# ── Resources ─────────────────────────────────────────────────────────────────
class NotFoundError(SMEFlowError):
    def __init__(self, resource: str = "Resource", resource_id: str = "") -> None:
        msg = f"{resource} not found" + (f": {resource_id}" if resource_id else "")
        super().__init__(msg, "NOT_FOUND", status.HTTP_404_NOT_FOUND)


class ConflictError(SMEFlowError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "CONFLICT", status.HTTP_409_CONFLICT)


class DuplicateError(SMEFlowError):
    def __init__(self, resource: str = "Resource") -> None:
        super().__init__(f"{resource} already exists", "DUPLICATE", status.HTTP_409_CONFLICT)


# ── Business Logic ────────────────────────────────────────────────────────────
class InsufficientStockError(SMEFlowError):
    def __init__(self, item_name: str, available: float, requested: float) -> None:
        super().__init__(
            f"Insufficient stock for '{item_name}': {available} available, {requested} requested",
            "INSUFFICIENT_STOCK",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"item": item_name, "available": available, "requested": requested},
        )


class PaymentError(SMEFlowError):
    def __init__(self, message: str, provider: str = "") -> None:
        super().__init__(
            message, "PAYMENT_ERROR", status.HTTP_502_BAD_GATEWAY, details={"provider": provider}
        )


class PaymentCapabilityError(SMEFlowError):
    def __init__(self, provider: str, capability: str) -> None:
        super().__init__(
            f"{provider} does not currently support {capability}",
            "PAYMENT_PROVIDER_UNSUPPORTED",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"provider": provider, "capability": capability},
        )


class LimitExceededError(SMEFlowError):
    def __init__(self, resource: str, limit: int) -> None:
        super().__init__(
            f"Free tier limit reached for {resource} ({limit}). Upgrade to continue.",
            "LIMIT_EXCEEDED",
            status.HTTP_402_PAYMENT_REQUIRED,
            details={"resource": resource, "limit": limit},
        )


class PlanFeatureRequiredError(SMEFlowError):
    def __init__(self, feature: str, required_plan: str = "starter") -> None:
        super().__init__(
            f"This feature requires the {required_plan} plan or higher. Upgrade to continue.",
            "PLAN_FEATURE_REQUIRED",
            status.HTTP_402_PAYMENT_REQUIRED,
            details={"feature": feature, "required_plan": required_plan},
        )


class IdempotencyConflictError(SMEFlowError):
    def __init__(self) -> None:
        super().__init__(
            "A different request with this Idempotency-Key was already processed.",
            "IDEMPOTENCY_CONFLICT",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class TenantMismatchError(SMEFlowError):
    def __init__(self) -> None:
        super().__init__(
            "Resource does not belong to this business.",
            "TENANT_MISMATCH",
            status.HTTP_403_FORBIDDEN,
        )


class KYCVerificationRequiredError(SMEFlowError):
    def __init__(
        self,
        message: str = "KYC verification is required to use this feature.",
        details: object = None,
    ) -> None:
        super().__init__(
            message,
            "KYC_VERIFICATION_REQUIRED",
            status.HTTP_403_FORBIDDEN,
            details=details,
        )


# ── Handler Registration ──────────────────────────────────────────────────────
def _error_response(
    status_code: int, code: str, message: str, details: object = None
) -> JSONResponse:
    body: dict = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body)


# Maps DB constraint names → human-readable messages returned in the API.
_CONSTRAINT_MESSAGES: dict[str, str] = {
    # Business
    "uq_business_owner_name": "You already have a business with this name.",
    "uq_business_tin": "This TIN is already registered to another business.",
    # Auth
    "users_phone_key": "This phone number is already registered.",
    "ix_users_phone": "This phone number is already registered.",
    # Business membership
    "uq_business_member": "This user is already a member of the business.",
    # Payments / MoMo
    "uq_momo_account": "A MoMo account with this provider and phone is already linked.",
    # Inventory
    "uq_category_name": "A category with this name already exists.",
    "uq_item_sku": "An item with this SKU already exists.",
    # Sales
    "uq_customer_phone": "A customer with this phone number already exists for this business.",
    # Invoicing
    "sales_idempotency_key_key": "A sale with this idempotency key was already recorded.",
}


def _parse_integrity_error(exc: sqlalchemy.exc.IntegrityError) -> tuple[str, str]:
    """
    Return (api_code, human_message) by inspecting the underlying DB error string.
    Falls back to a generic message if the constraint cannot be identified.
    """
    orig = str(getattr(exc, "orig", exc))

    # Try to find the constraint name in the error string
    m = re.search(r'constraint "([^"]+)"', orig)
    constraint = m.group(1) if m else ""

    if constraint in _CONSTRAINT_MESSAGES:
        return "CONFLICT", _CONSTRAINT_MESSAGES[constraint]

    # Fallback heuristics
    if "unique" in orig.lower() or "duplicate" in orig.lower():
        return "CONFLICT", "A record with these details already exists."

    if "foreign key" in orig.lower() or "violates foreign key" in orig.lower():
        # Try to extract the column name for a better message
        col = re.search(r'column "([^"]+)"', orig)
        resource = col.group(1).replace("_id", "").replace("_", " ") if col else "referenced record"
        return "INVALID_REFERENCE", f"The {resource} does not exist."

    if "not null" in orig.lower():
        col = re.search(r'column "([^"]+)"', orig)
        field = col.group(1).replace("_", " ") if col else "field"
        return "VALIDATION_ERROR", f"Required field '{field}' is missing."

    return "DATABASE_ERROR", "A database constraint was violated."


def register_exception_handlers(app: FastAPI) -> None:
    log = structlog.get_logger()

    @app.exception_handler(SMEFlowError)
    async def smeflow_error_handler(request: Request, exc: SMEFlowError) -> JSONResponse:
        return _error_response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            {"field": " → ".join(str(loc) for loc in e["loc"]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return _error_response(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VALIDATION_ERROR",
            "Request validation failed",
            errors,
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return _error_response(exc.status_code, "HTTP_ERROR", exc.detail)

    # ── SQLAlchemy / DB errors ────────────────────────────────────────────────

    @app.exception_handler(sqlalchemy.exc.IntegrityError)
    async def integrity_error_handler(
        request: Request, exc: sqlalchemy.exc.IntegrityError
    ) -> JSONResponse:
        """Convert unique-violation / FK errors into descriptive 4xx responses."""
        api_code, message = _parse_integrity_error(exc)
        http_status = (
            status.HTTP_409_CONFLICT if api_code in ("CONFLICT",) else status.HTTP_400_BAD_REQUEST
        )
        log.warning(
            "db.integrity_error",
            path=request.url.path,
            constraint=re.search(r'constraint "([^"]+)"', str(exc.orig or exc))
            and re.search(r'constraint "([^"]+)"', str(exc.orig or exc)).group(1),  # type: ignore[union-attr]
            message=message,
        )
        return _error_response(http_status, api_code, message)

    @app.exception_handler(sqlalchemy.exc.NoResultFound)
    async def no_result_handler(
        request: Request, exc: sqlalchemy.exc.NoResultFound
    ) -> JSONResponse:
        return _error_response(status.HTTP_404_NOT_FOUND, "NOT_FOUND", "Resource not found.")

    @app.exception_handler(sqlalchemy.exc.OperationalError)
    async def operational_error_handler(
        request: Request, exc: sqlalchemy.exc.OperationalError
    ) -> JSONResponse:
        log.error("db.operational_error", path=request.url.path, error=str(exc))
        return _error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "DATABASE_UNAVAILABLE",
            "The database is temporarily unavailable. Please retry in a moment.",
        )

    @app.exception_handler(sqlalchemy.exc.TimeoutError)
    async def timeout_error_handler(
        request: Request, exc: sqlalchemy.exc.TimeoutError
    ) -> JSONResponse:
        log.error("db.timeout", path=request.url.path)
        return _error_response(
            status.HTTP_504_GATEWAY_TIMEOUT,
            "DATABASE_TIMEOUT",
            "The request timed out waiting for the database. Please retry.",
        )

    # ── Catch-all ─────────────────────────────────────────────────────────────

    @app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_exception", path=request.url.path, exc_type=type(exc).__name__)

        # In development, expose the real error so it's debuggable immediately.
        from apps.api.core.config import get_settings

        if get_settings().is_development:
            import traceback

            return _error_response(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                f"{type(exc).__name__}: {exc}",
                details={"traceback": traceback.format_exc().splitlines()[-10:]},
            )

        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "An unexpected error occurred. Please try again.",
        )
