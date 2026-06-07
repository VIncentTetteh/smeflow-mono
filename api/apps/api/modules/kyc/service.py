"""KYC verification service."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.exceptions import KYCVerificationRequiredError, NotFoundError
from apps.api.modules.kyc.models import KYCVerification
from apps.api.modules.kyc.schemas import KYCReview, KYCSubmit

logger = structlog.get_logger()


class KYCService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, business_id: UUID) -> KYCVerification | None:
        result = await self.db.execute(
            select(KYCVerification).where(KYCVerification.business_id == business_id)
        )
        return result.scalar_one_or_none()

    async def submit(self, business_id: UUID, user_id: UUID, data: KYCSubmit) -> KYCVerification:
        verification = await self.get(business_id)
        if not verification:
            verification = KYCVerification(business_id=business_id, user_id=user_id)
            self.db.add(verification)

        verification.user_id = user_id
        verification.tin = data.tin
        verification.business_registration_ref = data.business_registration_ref
        verification.documents = data.documents  # type: ignore[assignment]  # JSONB accepts list[KYCDocument]
        verification.status = "pending"
        verification.failure_reason = None
        verification.submitted_at = datetime.now(timezone.utc)
        verification.reviewed_at = None
        await self.db.flush([verification])
        return verification

    async def review(self, business_id: UUID, data: KYCReview) -> KYCVerification:
        verification = await self.get(business_id)
        if not verification:
            raise NotFoundError("KYC verification")
        verification.status = data.status
        verification.provider = data.provider
        verification.provider_ref = data.provider_ref
        verification.failure_reason = data.failure_reason
        verification.reviewed_at = datetime.now(timezone.utc)
        await self.db.flush([verification])

        # Notify business owner of KYC decision (failure must not break the review).
        try:
            from apps.api.modules.notifications.service import NotificationService

            approved = data.status == "verified"
            if approved:
                msg = (
                    "Your KYC verification has been approved. "
                    "You can now access all SMEflow features."
                )
            else:
                reason_text = f" Reason: {data.failure_reason}" if data.failure_reason else ""
                msg = (
                    f"Your KYC verification was rejected.{reason_text} "
                    "Please resubmit with correct documents."
                )
            await NotificationService(self.db).dispatch_event(
                business_id=business_id,
                event_type="kyc_reviewed",
                data={"message": msg},
            )
        except Exception:
            logger.warning("notification.dispatch_failed", event_type="kyc_reviewed")

        if data.status == "verified":
            try:
                from apps.api.modules.business.dva_service import DVAService

                await DVAService(self.db).provision_for_business(business_id)
            except Exception as exc:
                logger.warning(
                    "kyc.dva_provision_failed",
                    business_id=str(business_id),
                    error=str(exc),
                )

        return verification

    async def require_verified(self, business_id: UUID) -> None:
        verification = await self.get(business_id)
        if not verification or verification.status != "verified":
            raise KYCVerificationRequiredError()
