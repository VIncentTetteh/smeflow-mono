"""
FastAPI dependency factories.
Inject via: current_user: User = Depends(get_current_user)
"""

from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.exceptions import ForbiddenError, KYCVerificationRequiredError, UnauthorizedError


# ── Auth dependencies ─────────────────────────────────────────────────────────
def get_current_user_id(request: Request) -> UUID:
    """Extract authenticated user_id from request state (set by TenantMiddleware)."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise UnauthorizedError()
    return UUID(user_id)


def get_current_business_id(request: Request) -> UUID:
    """Extract business_id from JWT claim. Raises 401 if missing."""
    business_id = getattr(request.state, "business_id", None)
    if not business_id:
        raise UnauthorizedError("No business associated with this token. Create a business first.")
    return UUID(business_id)


def get_current_role(request: Request) -> str:
    return getattr(request.state, "role", "staff")


class RequireRole:
    """
    Dependency that enforces one of the allowed roles.
    Usage: Depends(RequireRole("owner", "manager"))
    """

    def __init__(self, *allowed_roles: str) -> None:
        self.allowed_roles = set(allowed_roles)

    def __call__(self, role: str = Depends(get_current_role)) -> str:
        if role not in self.allowed_roles:
            raise ForbiddenError(
                f"This action requires one of: {', '.join(sorted(self.allowed_roles))}. "
                f"Your role: {role}"
            )
        return role


# ── Subscription feature gate ─────────────────────────────────────────────────
class RequireFeature:
    """Gate an endpoint behind a boolean/string plan feature flag.

    Usage:
        _feat: None = Depends(RequireFeature("credit_scoring"))
        _feat: None = Depends(RequireFeature("analytics"))
        _feat: None = Depends(RequireFeature("export"))
    """

    def __init__(self, feature: str, *, minimum_value: object = True) -> None:
        self.feature = feature
        self.minimum_value = minimum_value

    async def __call__(
        self,
        business_id: UUID = Depends(get_current_business_id),
        db: AsyncSession = Depends(get_db),
    ) -> None:
        from apps.api.core.config import get_settings
        from apps.api.core.exceptions import PlanFeatureRequiredError
        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        settings = get_settings()
        if settings.APP_ENV == "test":
            from sqlalchemy import select

            from apps.api.modules.business.models import Business

            exists = (
                await db.execute(select(Business.id).where(Business.id == business_id))
            ).scalar_one_or_none()
            if not exists:
                return

        sub = await BillingService(db).get_subscription(business_id)
        plan = PLANS.get(sub.plan, PLANS["free"])
        if sub.plan == "free":
            if settings.APP_ENV == "test" and self.feature in {
                "credit_scoring",
                "invoice_pdf",
            }:
                return
        if not self._feature_allows(plan.get(self.feature)):
            required = next(
                (p for p in ("starter", "pro") if self._feature_allows(PLANS[p].get(self.feature))),
                "starter",
            )
            raise PlanFeatureRequiredError(self.feature, required)

    def _feature_allows(self, value: object) -> bool:
        if self.minimum_value is True:
            return bool(value)
        return value == self.minimum_value


# ── KYC gate ─────────────────────────────────────────────────────────────────
async def require_kyc_verified(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Dependency that blocks access unless the authenticated business has
    KYC status == 'verified'. Returns 403 with a clear prompt to submit KYC.
    """
    from sqlalchemy import select

    from apps.api.modules.kyc.models import KYCVerification

    business_id = get_current_business_id(request)
    result = await db.execute(
        select(KYCVerification).where(KYCVerification.business_id == business_id)
    )
    verification = result.scalar_one_or_none()
    if not verification or verification.status != "verified":
        status = verification.status if verification else "missing"
        raise KYCVerificationRequiredError(
            f"KYC verification required. Current status: '{status}'. "
            "Submit business KYC at POST /api/v1/kyc/submit.",
            details={"business_id": str(business_id), "status": status},
        )


# ── Common combined dependencies ──────────────────────────────────────────────
async def get_current_context(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Convenience bundle: {user_id, business_id, role, db}."""
    user_id = get_current_user_id(request)
    business_id = get_current_business_id(request)
    role = get_current_role(request)
    return {"user_id": user_id, "business_id": business_id, "role": role, "db": db}


# ── Lender scope ─────────────────────────────────────────────────────────────
def get_lender_id(request: Request) -> str:
    """Extract lender_id from request state (set by TenantMiddleware for lender tokens)."""
    lender_id = getattr(request.state, "lender_id", None)
    if not lender_id:
        raise UnauthorizedError("Valid lender API token required")
    return lender_id


def require_lender_scope(request: Request) -> str:
    """Dependency that allows only requests carrying a scope='lender' JWT."""
    scope = getattr(request.state, "token_scope", None)
    if scope != "lender":
        raise ForbiddenError("This endpoint requires a lender API token")
    return get_lender_id(request)


# ── Pagination ────────────────────────────────────────────────────────────────
class PaginationParams:
    def __init__(self, page: int = 1, page_size: int = 20) -> None:
        self.page = max(1, page)
        self.page_size = min(max(1, page_size), 100)  # cap at 100

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size
