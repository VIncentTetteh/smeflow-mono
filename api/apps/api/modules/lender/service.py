"""Lender partner service — anonymised credit profile retrieval and consent management."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.core.exceptions import ForbiddenError, NotFoundError
from apps.api.core.security import generate_secure_token, hash_password, verify_password
from apps.api.modules.credit.models import CreditScore, LenderConsent, LoanRequest
from apps.api.modules.kyc.models import KYCVerification
from apps.api.modules.lender.models import LenderPartner, LoanProduct

logger = structlog.get_logger()

# Revenue bands in GHS monthly revenue (approximate)
_REVENUE_BANDS = [
    (Decimal("0"), "low"),
    (Decimal("5000"), "medium"),
    (Decimal("20000"), "high"),
    (Decimal("50000"), "very_high"),
]


class LenderService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Partner provisioning/authentication ──────────────────────────────────

    async def create_partner(
        self,
        lender_id: str,
        name: str,
        contact_email: str | None = None,
        portal_email: str | None = None,
    ) -> tuple[LenderPartner, str, str]:
        api_key = f"lf_{secrets.token_urlsafe(32)}"
        temporary_password = self._temporary_portal_password()
        normalized_portal_email = (portal_email or contact_email or "").lower().strip() or None
        partner = LenderPartner(
            lender_id=lender_id,
            name=name,
            contact_email=contact_email,
            portal_email=normalized_portal_email,
            portal_password_hash=hash_password(temporary_password)
            if normalized_portal_email
            else None,
            must_reset_password=bool(normalized_portal_email),
            api_key_hash=hash_password(api_key),
            api_key_hint=api_key[-4:],
            is_active=True,
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=get_settings().LENDER_API_KEY_EXPIRY_DAYS),
            webhook_secret=f"lf_whsec_{generate_secure_token(24)}",
        )
        self.db.add(partner)
        await self.db.flush([partner])
        logger.info("lender.partner_created", lender_id=lender_id)
        return partner, api_key, temporary_password

    async def provision_paystack_subaccount(
        self,
        lender_id: str,
        settlement_bank_code: str,
        settlement_account_number: str,
        platform_fee_percent: float,
    ) -> LenderPartner:
        """
        Idempotently create a Paystack settlement subaccount and split for a lender.

        - If subaccount already exists, skips subaccount creation.
        - If split already exists, skips split creation.
        - Safe to call multiple times (e.g., re-run after partial failure).

        The split routes (100 - platform_fee_percent)% to the lender's subaccount;
        the remainder stays in the SMEflow Paystack balance as platform revenue.
        """
        from libs.payment_clients.paystack import PaystackClient

        partner = await self._get_partner(lender_id)
        client = PaystackClient()

        try:
            # ── Step 1: Create subaccount (skip if already provisioned) ──────────
            if not partner.paystack_subaccount_code:
                subaccount = await client.create_subaccount(
                    business_name=partner.name,
                    settlement_bank=settlement_bank_code,
                    account_number=settlement_account_number,
                    percentage_charge=round(100.0 - platform_fee_percent, 2),
                )
                partner.paystack_subaccount_code = subaccount.get("subaccount_code", "")
                partner.settlement_bank_code = settlement_bank_code
                partner.settlement_account_number = settlement_account_number
                partner.platform_fee_percent = platform_fee_percent
                await self.db.flush([partner])
                logger.info(
                    "lender.paystack_subaccount_created",
                    lender_id=lender_id,
                    subaccount_code=partner.paystack_subaccount_code,
                )
            else:
                logger.info(
                    "lender.paystack_subaccount_already_exists",
                    lender_id=lender_id,
                    subaccount_code=partner.paystack_subaccount_code,
                )

            # ── Step 2: Create split (skip if already provisioned) ────────────────
            if not partner.paystack_split_code:
                split = await client.create_split(
                    name=f"lender-{lender_id}-split",
                    subaccounts=[
                        {
                            "subaccount": partner.paystack_subaccount_code,
                            "share": round(100 - platform_fee_percent),
                        }
                    ],
                    bearer_type="account",
                )
                partner.paystack_split_code = split.get("split_code", "")
                await self.db.flush([partner])
                logger.info(
                    "lender.paystack_split_created",
                    lender_id=lender_id,
                    split_code=partner.paystack_split_code,
                )
            else:
                logger.info(
                    "lender.paystack_split_already_exists",
                    lender_id=lender_id,
                    split_code=partner.paystack_split_code,
                )
        finally:
            await client._close()

        logger.info(
            "lender.paystack_subaccount_provisioned",
            lender_id=lender_id,
            subaccount_code=partner.paystack_subaccount_code,
            split_code=partner.paystack_split_code,
        )
        return partner

    async def list_all_lenders(
        self, limit: int = 50, offset: int = 0
    ) -> tuple[list[LenderPartner], int]:
        """Return paginated list of all lender partners (admin view)."""
        from sqlalchemy import func

        count = (await self.db.execute(select(func.count(LenderPartner.id)))).scalar_one()
        partners = (
            (
                await self.db.execute(
                    select(LenderPartner)
                    .order_by(LenderPartner.created_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(partners), count

    async def update_partner(
        self,
        lender_id: str,
        name: str | None = None,
        contact_email: str | None = None,
        is_active: bool | None = None,
        rotate_key: bool = False,
    ) -> tuple[LenderPartner, str | None]:
        partner = await self._get_partner(lender_id)
        if name is not None:
            partner.name = name
        if contact_email is not None:
            partner.contact_email = contact_email
        if is_active is not None:
            partner.is_active = is_active
        api_key = None
        if rotate_key:
            api_key = f"lf_{secrets.token_urlsafe(32)}"
            partner.api_key_hash = hash_password(api_key)
            partner.api_key_hint = api_key[-4:]
            partner.expires_at = datetime.now(timezone.utc) + timedelta(
                days=get_settings().LENDER_API_KEY_EXPIRY_DAYS
            )
            partner.rotation_alerted_at = None
        await self.db.flush([partner])
        logger.info("lender.partner_updated", lender_id=lender_id, rotated=rotate_key)
        return partner, api_key

    async def verify_api_key(self, lender_id: str, api_key: str) -> bool:
        partner = (
            await self.db.execute(
                select(LenderPartner).where(
                    LenderPartner.lender_id == lender_id,
                    LenderPartner.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if partner:
            if partner.expires_at:
                expires_at = partner.expires_at
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at < datetime.now(timezone.utc):
                    return False
            if verify_password(api_key, partner.api_key_hash):
                partner.last_auth_at = datetime.now(timezone.utc)
                await self.db.flush([partner])
                return True
            return False
        # No DB partner found — no stored hash available, so fail closed
        return False

    async def authenticate_portal_login(
        self, email: str, password: str
    ) -> tuple[LenderPartner, bool]:
        portal_email = email.lower().strip()
        partner = (
            await self.db.execute(
                select(LenderPartner).where(
                    LenderPartner.portal_email == portal_email,
                    LenderPartner.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if not partner or not partner.portal_password_hash:
            raise ForbiddenError("Invalid lender credentials")
        if not verify_password(password, partner.portal_password_hash):
            raise ForbiddenError("Invalid lender credentials")
        if partner.must_reset_password:
            return partner, True
        partner.last_login_at = datetime.now(timezone.utc)
        await self.db.flush([partner])
        return partner, False

    async def reset_portal_password(self, lender_id: str, new_password: str) -> LenderPartner:
        partner = await self.ensure_active_partner(lender_id)
        if not partner.must_reset_password:
            raise ForbiddenError("Password reset token has already been used")
        partner.portal_password_hash = hash_password(new_password)
        partner.must_reset_password = False
        now = datetime.now(timezone.utc)
        partner.password_reset_at = now
        partner.last_login_at = now
        await self.db.flush([partner])
        return partner

    @staticmethod
    def _temporary_portal_password() -> str:
        return f"Sf-{secrets.token_urlsafe(14)}"

    async def _get_partner(self, lender_id: str) -> LenderPartner:
        partner = (
            await self.db.execute(select(LenderPartner).where(LenderPartner.lender_id == lender_id))
        ).scalar_one_or_none()
        if not partner:
            raise NotFoundError("LenderPartner", lender_id)
        return partner

    async def ensure_active_partner(self, lender_id: str) -> LenderPartner:
        partner = await self._get_partner(lender_id)
        if not partner.is_active:
            raise ForbiddenError("Lender partner is not active")
        return partner

    # ── Consent management ────────────────────────────────────────────────────

    async def grant_consent(self, business_id: UUID, lender_id: str) -> LenderConsent:
        result = await self.db.execute(
            select(LenderConsent).where(
                LenderConsent.business_id == business_id,
                LenderConsent.lender_id == lender_id,
            )
        )
        consent = result.scalar_one_or_none()
        if consent:
            consent.is_active = True
            consent.revoked_at = None
        else:
            consent = LenderConsent(
                business_id=business_id,
                lender_id=lender_id,
                is_active=True,
            )
            self.db.add(consent)
        await self.db.flush([consent])
        logger.info("lender.consent_granted", business_id=str(business_id), lender_id=lender_id)
        return consent

    async def revoke_consent(self, business_id: UUID, lender_id: str) -> LenderConsent:
        result = await self.db.execute(
            select(LenderConsent).where(
                LenderConsent.business_id == business_id,
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        )
        consent = result.scalar_one_or_none()
        if not consent:
            raise NotFoundError("LenderConsent", lender_id)
        consent.is_active = False
        consent.revoked_at = datetime.now(timezone.utc)
        await self.db.flush([consent])
        logger.info("lender.consent_revoked", business_id=str(business_id), lender_id=lender_id)
        return consent

    async def list_consents(self, business_id: UUID) -> list[dict]:
        result = await self.db.execute(
            select(LenderConsent, LenderPartner.name.label("lender_name"))
            .outerjoin(LenderPartner, LenderPartner.lender_id == LenderConsent.lender_id)
            .where(
                LenderConsent.business_id == business_id,
                LenderConsent.is_active.is_(True),
            )
            .order_by(LenderConsent.consented_at.desc())
        )
        rows = result.all()
        out = []
        for row in rows:
            consent = row.LenderConsent
            out.append({
                "id": consent.id,
                "business_id": consent.business_id,
                "lender_id": consent.lender_id,
                "is_active": consent.is_active,
                "consented_at": consent.consented_at,
                "revoked_at": consent.revoked_at,
                "lender_name": row.lender_name,
            })
        return out

    # ── Anonymised profile ────────────────────────────────────────────────────

    async def get_anonymized_profile(self, business_id: UUID, lender_id: str) -> dict:
        """Return an anonymised credit profile for a lender, guarded by active consent."""
        # Check consent
        consent_result = await self.db.execute(
            select(LenderConsent).where(
                LenderConsent.business_id == business_id,
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        )
        if not consent_result.scalar_one_or_none():
            raise ForbiddenError("Business has not consented to share data with this lender")

        # Fetch latest credit score
        score_result = await self.db.execute(
            select(CreditScore)
            .where(CreditScore.business_id == business_id)
            .order_by(CreditScore.computed_at.desc())
            .limit(1)
        )
        score_obj = score_result.scalar_one_or_none()
        if not score_obj:
            raise NotFoundError("CreditScore", str(business_id))

        # Repayment history — check approved loan requests
        loans_result = await self.db.execute(
            select(LoanRequest)
            .where(
                LoanRequest.business_id == business_id,
                LoanRequest.status.in_(["disbursed", "repaid", "defaulted"]),
            )
            .order_by(LoanRequest.disbursed_at.desc())
            .limit(10)
        )
        loans = list(loans_result.scalars().all())
        repayment_summary = self._summarise_repayments(loans)

        # Account age from business
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(select(Business).where(Business.id == business_id))
        biz = biz_result.scalar_one_or_none()
        account_age_days = 0
        if biz and biz.created_at:
            delta = (
                datetime.now(timezone.utc) - biz.created_at.replace(tzinfo=timezone.utc)
                if biz.created_at.tzinfo is None
                else datetime.now(timezone.utc) - biz.created_at
            )
            account_age_days = max(0, delta.days)

        # Revenue band from credit score factors
        avg_monthly_rev = Decimal(str(score_obj.factors.get("avg_monthly_revenue", 0)))
        revenue_band = self._revenue_band(avg_monthly_rev)

        # Monthly revenue list from score factors
        monthly_revenue: list[dict] = []
        factors = score_obj.factors or {}
        if "monthly_revenues" in factors and isinstance(factors["monthly_revenues"], list):
            monthly_revenue = factors["monthly_revenues"]
        else:
            rev_30d = factors.get("revenue_30d")
            rev_90d = factors.get("revenue_90d")
            if rev_30d is not None:
                monthly_revenue = [{"month": "Last 30d", "amount": float(rev_30d)}]
            elif rev_90d is not None:
                monthly_revenue = [{"month": "Last 90d", "amount": float(rev_90d) / 3}]

        # Risk indicators from score factors
        repayment_tone = (
            "success" if repayment_summary == "good"
            else "warn" if repayment_summary == "fair"
            else "danger" if repayment_summary == "poor"
            else "neutral"
        )
        rev_band_tone = "success" if revenue_band in ("high", "very_high") else "neutral"
        age_tone = "success" if account_age_days > 180 else "neutral"
        risk_indicators = [
            {"label": "Revenue band", "value": revenue_band, "tone": rev_band_tone},
            {"label": "Repayment history", "value": repayment_summary, "tone": repayment_tone},
            {"label": "Account age", "value": f"{account_age_days} days", "tone": age_tone},
        ]

        # KYC status
        kyc_result = await self.db.execute(
            select(KYCVerification).where(KYCVerification.business_id == business_id)
        )
        kyc_obj = kyc_result.scalar_one_or_none()
        kyc_status = kyc_obj.status if kyc_obj else "not_started"

        # Active consent granted_at
        consent_result2 = await self.db.execute(
            select(LenderConsent).where(
                LenderConsent.business_id == business_id,
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        )
        active_consent = consent_result2.scalar_one_or_none()
        consent_granted_at = active_consent.consented_at if active_consent else None

        # One-way hash — never expose raw business_id
        ref = hashlib.sha256(f"{business_id}{lender_id}".encode()).hexdigest()

        return {
            "lender_business_ref": ref,
            "score": score_obj.score,
            "band": score_obj.band,
            "max_loan_amount": score_obj.max_loan_amount,
            "account_age_days": account_age_days,
            "revenue_band": revenue_band,
            "repayment_history_summary": repayment_summary,
            "computed_at": score_obj.computed_at,
            "kyc_status": kyc_status,
            "monthly_revenue": monthly_revenue,
            "risk_indicators": risk_indicators,
            "consent_granted_at": consent_granted_at,
        }

    async def list_consented_businesses(
        self, lender_id: str, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict], int]:
        """Return richer business dicts for businesses that have consented to this lender."""
        from sqlalchemy import func as sqlfunc

        count_result = await self.db.execute(
            select(sqlfunc.count(LenderConsent.id)).where(
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        )
        total = count_result.scalar_one()

        consent_rows = (
            await self.db.execute(
                select(LenderConsent)
                .where(
                    LenderConsent.lender_id == lender_id,
                    LenderConsent.is_active.is_(True),
                )
                .order_by(LenderConsent.consented_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars().all()

        from apps.api.modules.business.models import Business

        items = []
        for consent in consent_rows:
            business_id = consent.business_id
            ref = hashlib.sha256(f"{business_id}{lender_id}".encode()).hexdigest()

            # Latest credit score band
            score_row = (
                await self.db.execute(
                    select(CreditScore.band)
                    .where(CreditScore.business_id == business_id)
                    .order_by(CreditScore.computed_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            # Account age
            biz_row = (
                await self.db.execute(
                    select(Business.created_at).where(Business.id == business_id)
                )
            ).scalar_one_or_none()
            account_age_days = 0
            if biz_row:
                created_at = biz_row
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                account_age_days = max(0, (datetime.now(timezone.utc) - created_at).days)

            # Has active loan
            active_loan = (
                await self.db.execute(
                    select(LoanRequest.id).where(
                        LoanRequest.business_id == business_id,
                        LoanRequest.status == "active",
                    ).limit(1)
                )
            ).scalar_one_or_none()

            items.append({
                "business_ref": ref,
                "credit_band": score_row,
                "account_age_days": account_age_days,
                "has_active_loan": active_loan is not None,
                "consented_at": consent.consented_at.isoformat(),
            })
        return items, total

    async def resolve_business_ref(self, business_ref: str, lender_id: str) -> UUID:
        """Resolve a lender-safe business ref to a business id after consent."""
        result = await self.db.execute(
            select(LenderConsent.business_id).where(
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        )
        for row in result.all():
            business_id = row[0]
            if hashlib.sha256(f"{business_id}{lender_id}".encode()).hexdigest() == business_ref:
                return business_id
        raise ForbiddenError("Business has not consented to share data with this lender")

    async def list_loans_for_lender(
        self,
        lender_id: str,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """
        Return loan requests visible to this lender:
          - All 'pending_partner' requests (open pool — any lender can see them)
          - Requests assigned to this specific lender (any status)

        Business IDs are anonymised to lender_business_refs using a SHA-256 hash
        so the lender cannot correlate requests across their portfolio by identity.
        """
        filters = [
            or_(
                LoanRequest.lender_id == lender_id,
                and_(
                    LoanRequest.status == "pending_partner",
                    LoanRequest.lender_id.is_(None),
                    exists(
                        select(LenderConsent.id).where(
                            LenderConsent.business_id == LoanRequest.business_id,
                            LenderConsent.lender_id == lender_id,
                            LenderConsent.is_active.is_(True),
                        )
                    ),
                ),
            )
        ]
        if status:
            filters.append(LoanRequest.status == status)

        result = await self.db.execute(
            select(LoanRequest, CreditScore)
            .outerjoin(CreditScore, CreditScore.id == LoanRequest.credit_score_id)
            .where(*filters)
            .order_by(LoanRequest.requested_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = result.all()

        items = []
        for row in rows:
            loan = row.LoanRequest
            score = row.CreditScore
            ref = hashlib.sha256(f"{loan.business_id}{lender_id}".encode()).hexdigest()
            items.append(
                {
                    "id": loan.id,
                    "business_ref": ref,
                    "amount_requested": loan.amount_requested,
                    "credit_score": score.score if score else None,
                    "credit_band": score.band if score else None,
                    "status": loan.status,
                    "requested_at": loan.requested_at,
                }
            )
        return items

    # ── Loan products ─────────────────────────────────────────────────────────

    async def create_product(self, lender_id: str, data: dict) -> LoanProduct:
        product = LoanProduct(lender_id=lender_id, **data)
        self.db.add(product)
        await self.db.flush([product])
        logger.info("lender.product_created", lender_id=lender_id, product_name=data.get("name"))
        return product

    async def list_products(self, lender_id: str) -> list[LoanProduct]:
        result = await self.db.execute(
            select(LoanProduct)
            .where(LoanProduct.lender_id == lender_id)
            .order_by(LoanProduct.created_at.desc())
        )
        return list(result.scalars().all())

    async def update_product(self, product_id: UUID, lender_id: str, data: dict) -> LoanProduct:
        product = await self._get_product(product_id, lender_id)
        for key, value in data.items():
            if value is not None:
                setattr(product, key, value)
        await self.db.flush([product])
        return product

    async def deactivate_product(self, product_id: UUID, lender_id: str) -> LoanProduct:
        product = await self._get_product(product_id, lender_id)
        product.is_active = False
        await self.db.flush([product])
        logger.info("lender.product_deactivated", product_id=str(product_id), lender_id=lender_id)
        return product

    async def _get_product(self, product_id: UUID, lender_id: str) -> LoanProduct:
        result = await self.db.execute(
            select(LoanProduct).where(
                LoanProduct.id == product_id,
                LoanProduct.lender_id == lender_id,
            )
        )
        product = result.scalar_one_or_none()
        if not product:
            raise NotFoundError("LoanProduct", str(product_id))
        return product

    async def list_active_lenders_with_products(self) -> list[dict]:
        """Return all active lenders with their active loan products."""
        partners_result = await self.db.execute(
            select(LenderPartner)
            .where(LenderPartner.is_active.is_(True))
            .order_by(LenderPartner.name)
        )
        partners = list(partners_result.scalars().all())

        output = []
        for partner in partners:
            products_result = await self.db.execute(
                select(LoanProduct)
                .where(
                    LoanProduct.lender_id == partner.lender_id,
                    LoanProduct.is_active.is_(True),
                )
                .order_by(LoanProduct.name)
            )
            products = list(products_result.scalars().all())
            output.append(
                {
                    "lender_id": partner.lender_id,
                    "name": partner.name,
                    "contact_email": partner.contact_email,
                    "products": products,
                }
            )
        return output


    async def get_loan_for_lender(self, loan_id: UUID, lender_id: str) -> dict:
        """Return a single loan visible to this lender, or raise ForbiddenError."""
        loan_result = await self.db.execute(
            select(LoanRequest, CreditScore)
            .outerjoin(CreditScore, CreditScore.id == LoanRequest.credit_score_id)
            .where(LoanRequest.id == loan_id)
        )
        row = loan_result.one_or_none()
        if not row:
            raise NotFoundError("LoanRequest", str(loan_id))
        loan = row.LoanRequest
        score = row.CreditScore

        # Check access: assigned to lender OR pending_partner with active consent
        accessible = loan.lender_id == lender_id
        if not accessible and loan.status == "pending_partner" and loan.lender_id is None:
            consent_check = (
                await self.db.execute(
                    select(LenderConsent.id).where(
                        LenderConsent.business_id == loan.business_id,
                        LenderConsent.lender_id == lender_id,
                        LenderConsent.is_active.is_(True),
                    )
                )
            ).scalar_one_or_none()
            accessible = consent_check is not None

        if not accessible:
            raise ForbiddenError("Loan is not accessible to this lender")

        ref = hashlib.sha256(f"{loan.business_id}{lender_id}".encode()).hexdigest()
        return {
            "id": loan.id,
            "business_ref": ref,
            "amount_requested": loan.amount_requested,
            "amount_approved": loan.amount_approved,
            "interest_rate": loan.interest_rate,
            "term_days": loan.term_days,
            "status": loan.status,
            "requested_at": loan.requested_at,
            "credit_score": score.score if score else None,
            "credit_band": score.band if score else None,
            "partner_ref": loan.partner_ref,
            "rejection_reason": loan.rejection_reason,
            "disbursed_at": loan.disbursed_at,
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _revenue_band(self, monthly_revenue: Decimal) -> str:
        band = "low"
        for threshold, label in _REVENUE_BANDS:
            if monthly_revenue >= threshold:
                band = label
        return band

    def _summarise_repayments(self, loans: list) -> str:
        if not loans:
            return "no_data"
        defaulted = sum(1 for loan in loans if loan.status == "defaulted")
        if defaulted == 0:
            return "good"
        ratio = defaulted / len(loans)
        if ratio <= 0.25:
            return "fair"
        return "poor"

    # ── Repayment charge with lender split ────────────────────────────────────

    async def initiate_repayment_charge(
        self,
        instalment_id: UUID,
        phone: str,
        provider: str,
        business_id: UUID,
    ) -> dict:
        """
        Initiate a MoMo charge for a loan repayment instalment.

        If the loan's lender has a Paystack split_code configured, attaches it
        to the charge so lender revenue is separated atomically at collection time.

        Returns a dict with { paystack_ref, status, provider_message }.
        """
        from apps.api.core.audit import audit
        from apps.api.modules.credit.models import LoanRequest, RepaymentInstalment
        from libs.payment_clients.paystack import PaystackClient

        # Load instalment + loan
        result = await self.db.execute(
            select(RepaymentInstalment)
            .where(RepaymentInstalment.id == instalment_id)
        )
        instalment = result.scalar_one_or_none()
        if not instalment:
            raise NotFoundError("RepaymentInstalment", str(instalment_id))

        if instalment.status in ("paid",):
            raise Exception(f"Instalment {instalment_id} is already paid")

        loan_result = await self.db.execute(
            select(LoanRequest).where(LoanRequest.id == instalment.loan_request_id)
        )
        loan = loan_result.scalar_one_or_none()
        if not loan:
            raise NotFoundError("LoanRequest", str(instalment.loan_request_id))

        # Build deterministic reference
        reference = f"repay-{str(instalment_id)[:12]}"

        # Check if idempotent — same reference already charged
        if instalment.paystack_ref == reference:
            return {
                "paystack_ref": reference,
                "status": instalment.status,
                "provider_message": "Already initiated",
            }

        # Resolve lender split_code (if configured)
        split_code: str | None = None
        if loan.lender_id:
            lender_result = await self.db.execute(
                select(LenderPartner).where(LenderPartner.lender_id == loan.lender_id)
            )
            lender = lender_result.scalar_one_or_none()
            if lender and lender.paystack_split_code:
                split_code = lender.paystack_split_code

        client = PaystackClient(provider=provider)
        try:
            if split_code:
                from apps.api.modules.auth.service import _derive_email_from_business_id  # noqa: F401
                # Use derive_email helper from PaystackClient
                email = client._derive_email(phone)
                response = await client.initialize_charge_with_split(
                    email=email,
                    amount_ghs=instalment.amount,
                    reference=reference,
                    split_code=split_code,
                    phone=phone,
                    provider=provider,
                    metadata={
                        "payment_type": "loan_repayment",
                        "instalment_id": str(instalment_id),
                        "loan_id": str(loan.id),
                        "business_id": str(business_id),
                    },
                )
            else:
                response = await client.request_payment(
                    amount=instalment.amount,
                    phone=phone,
                    reference=reference,
                    description=f"SMEflow loan repayment — instalment {instalment.instalment_number}",
                )
        finally:
            await client._close()

        # Update instalment tracking
        instalment.paystack_ref = response.external_ref or reference
        instalment.split_code_used = split_code
        instalment.collection_attempts = (instalment.collection_attempts or 0) + 1
        instalment.last_attempt_at = datetime.now(timezone.utc)
        instalment.status = "collecting"
        await self.db.flush([instalment])

        await audit(
            self.db,
            action="loan.repayment.charge_initiated",
            resource_type="RepaymentInstalment",
            resource_id=instalment_id,
            business_id=business_id,
            after={
                "reference": instalment.paystack_ref,
                "split_code": split_code,
                "amount": str(instalment.amount),
                "provider": provider,
            },
        )
        logger.info(
            "loan.repayment.charge_initiated",
            instalment_id=str(instalment_id),
            reference=instalment.paystack_ref,
            split_code=split_code,
            provider=provider,
        )
        return {
            "paystack_ref": instalment.paystack_ref,
            "status": response.status,
            "provider_message": response.provider_message,
        }

    async def confirm_repayment(
        self, paystack_ref: str, business_id: UUID | None = None
    ) -> dict:
        """
        Confirm a repayment instalment payment (called by webhook charge.success handler).
        Marks instalment as paid. Checks if all instalments are paid to close the loan.
        Fires lender webhook + merchant notification.
        Returns { instalment_id, loan_id, fully_repaid }.
        """
        from apps.api.core.audit import audit
        from apps.api.modules.credit.models import LoanRequest, RepaymentInstalment
        from apps.api.modules.credit.service import CreditService
        from apps.api.modules.notifications.service import NotificationService

        result = await self.db.execute(
            select(RepaymentInstalment).where(RepaymentInstalment.paystack_ref == paystack_ref)
        )
        instalment = result.scalar_one_or_none()
        if not instalment:
            return {"error": "no_matching_instalment", "paystack_ref": paystack_ref}

        if instalment.status == "paid":
            return {
                "instalment_id": str(instalment.id),
                "status": "already_paid",
                "fully_repaid": False,
            }

        now = datetime.now(timezone.utc)
        instalment.status = "paid"
        instalment.paid_at = now
        await self.db.flush([instalment])

        # Check if all instalments for this loan are paid
        loan_result = await self.db.execute(
            select(LoanRequest).where(LoanRequest.id == instalment.loan_request_id)
        )
        loan = loan_result.scalar_one_or_none()
        fully_repaid = False

        if loan:
            all_instalments = (
                await self.db.execute(
                    select(RepaymentInstalment).where(
                        RepaymentInstalment.loan_request_id == loan.id
                    )
                )
            ).scalars().all()

            if all(i.status == "paid" for i in all_instalments):
                fully_repaid = True
                svc = CreditService(self.db)
                await svc._transition_loan(loan, "repaid")
                loan.repaid_at = now
                await self.db.flush([loan])
                await svc._notify_merchant(loan, "repaid")
                await svc._notify_lender_webhook(loan, "loan.repaid")
            else:
                # Notify merchant of instalment confirmation
                try:
                    await NotificationService(self.db).dispatch_event(
                        business_id=loan.business_id,
                        event_type="loan_status_changed",
                        data={
                            "message": (
                                f"Repayment of GHS {instalment.amount} confirmed. "
                                f"Instalment {instalment.instalment_number} is paid."
                            )
                        },
                    )
                except Exception:
                    pass

            # Fire lender webhook for revenue tracking
            try:
                await svc._notify_lender_webhook(loan, "loan.repayment")
            except Exception:
                pass

        await audit(
            self.db,
            action="loan.repayment.confirmed",
            resource_type="RepaymentInstalment",
            resource_id=instalment.id,
            business_id=business_id or (loan.business_id if loan else None),
            after={
                "paystack_ref": paystack_ref,
                "amount": str(instalment.amount),
                "fully_repaid": fully_repaid,
            },
        )
        logger.info(
            "loan.repayment.confirmed",
            instalment_id=str(instalment.id),
            paystack_ref=paystack_ref,
            fully_repaid=fully_repaid,
        )
        return {
            "instalment_id": str(instalment.id),
            "loan_id": str(instalment.loan_request_id),
            "status": "confirmed",
            "fully_repaid": fully_repaid,
        }
