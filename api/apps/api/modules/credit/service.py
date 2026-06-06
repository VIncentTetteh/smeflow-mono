"""Credit scoring and loan request service."""

from __future__ import annotations

import hmac as _hmac
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.audit import audit
from apps.api.core.config import get_settings
from apps.api.core.exceptions import ConflictError, ForbiddenError, InvalidOTPError, NotFoundError
from apps.api.core.redis import RedisCache, get_otp_redis
from apps.api.core.security import _hash_otp, generate_otp
from apps.api.modules.credit.models import CreditScore, LoanRequest, RepaymentInstalment
from apps.api.modules.credit.scoring import CreditScoringEngine, compute_factors

logger = structlog.get_logger()

# Redis key prefix for loan-confirm OTPs
_LOAN_OTP_PREFIX = "loan_confirm"
_LOAN_OTP_TTL = 600  # 10 minutes


class CreditService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Credit scoring ────────────────────────────────────────────────────────

    async def compute_and_store_score(self, business_id: UUID) -> CreditScore:
        factors = await compute_factors(self.db, business_id)
        result = CreditScoringEngine().compute(factors)
        score = CreditScore(
            business_id=business_id,
            score=result.score,
            band=result.band,
            max_loan_amount=result.max_loan_amount,
            factors=result.factors,
        )
        self.db.add(score)
        await self.db.flush([score])
        return score

    async def current_score(self, business_id: UUID) -> CreditScore:
        result = await self.db.execute(
            select(CreditScore)
            .where(CreditScore.business_id == business_id)
            .order_by(CreditScore.computed_at.desc())
            .limit(1)
        )
        score = result.scalar_one_or_none()
        if score:
            max_age = timedelta(hours=get_settings().CREDIT_SCORE_MAX_AGE_HOURS)
            computed_at = score.computed_at
            if computed_at.tzinfo is None:
                computed_at = computed_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - computed_at > max_age:
                score.staleness_warning = True
                try:
                    from apps.api.workers.tasks.credit_tasks import compute_credit_score

                    compute_credit_score.delay(str(business_id))
                except Exception as exc:
                    logger.warning(
                        "credit.score_recompute_enqueue_failed",
                        business_id=str(business_id),
                        error=str(exc),
                    )
            return score
        return await self.compute_and_store_score(business_id)

    async def score_history(self, business_id: UUID, limit: int = 20) -> list[CreditScore]:
        result = await self.db.execute(
            select(CreditScore)
            .where(CreditScore.business_id == business_id)
            .order_by(CreditScore.computed_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    # ── Loan request ──────────────────────────────────────────────────────────

    async def create_loan_request(
        self,
        business_id: UUID,
        amount_requested: Decimal,
        term_days: int,
        target_lender_id: str | None = None,
        disbursement_phone: str | None = None,
        loan_product_id: UUID | None = None,
    ) -> LoanRequest:
        """Create a new loan request and submit it to the lender pool."""
        score = await self.current_score(business_id)

        # Validate requested amount against credit limit
        if score.max_loan_amount and amount_requested > score.max_loan_amount:
            raise ForbiddenError(
                f"Requested amount {amount_requested} exceeds approved credit limit "
                f"{score.max_loan_amount} for band {score.band}"
            )

        # If a loan product is selected, validate against product constraints
        if loan_product_id:
            from apps.api.modules.lender.models import LoanProduct

            product_result = await self.db.execute(
                select(LoanProduct).where(
                    LoanProduct.id == loan_product_id,
                    LoanProduct.is_active.is_(True),
                )
            )
            product = product_result.scalar_one_or_none()
            if not product:
                raise NotFoundError("LoanProduct", str(loan_product_id))

            band_order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}
            if band_order.get(score.band, 4) > band_order.get(product.min_credit_band, 2):
                raise ForbiddenError(
                    f"This product requires credit band {product.min_credit_band} or better. "
                    f"Your current band is {score.band}."
                )
            if (
                amount_requested < product.min_amount_ghs
                or amount_requested > product.max_amount_ghs
            ):
                raise ForbiddenError(
                    f"Amount must be between GHS {product.min_amount_ghs} and "
                    f"GHS {product.max_amount_ghs} for this product."
                )
            if term_days < product.min_term_days or term_days > product.max_term_days:
                raise ForbiddenError(
                    f"Term must be between {product.min_term_days} and "
                    f"{product.max_term_days} days for this product."
                )
            # Auto-route to the product's lender
            if not target_lender_id:
                target_lender_id = product.lender_id

        # Prevent duplicate active requests
        existing = await self.db.execute(
            select(LoanRequest).where(
                LoanRequest.business_id == business_id,
                LoanRequest.status.in_(
                    ["pending_partner", "approved", "confirmed", "disbursing", "active"]
                ),
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError("Business already has an active or pending loan request")

        # Resolve disbursement phone
        if not disbursement_phone:
            disbursement_phone = await self._primary_momo_phone(business_id)

        if target_lender_id:
            from apps.api.modules.lender.service import LenderService

            await LenderService(self.db).ensure_active_partner(target_lender_id)
            await LenderService(self.db).grant_consent(business_id, target_lender_id)

        request = LoanRequest(
            business_id=business_id,
            credit_score_id=score.id,
            amount_requested=amount_requested,
            term_days=term_days,
            status="pending_partner",
            disbursement_phone=disbursement_phone,
            lender_id=target_lender_id,
        )
        self.db.add(request)
        await self.db.flush([request])
        logger.info(
            "loan.requested",
            loan_id=str(request.id),
            business_id=str(business_id),
            amount=str(amount_requested),
            loan_product_id=str(loan_product_id) if loan_product_id else None,
        )
        return request

    async def list_requests(self, business_id: UUID) -> list[LoanRequest]:
        result = await self.db.execute(
            select(LoanRequest)
            .where(LoanRequest.business_id == business_id)
            .order_by(LoanRequest.requested_at.desc())
        )
        return list(result.scalars().all())

    async def get_loan(self, loan_id: UUID, business_id: UUID) -> LoanRequest:
        result = await self.db.execute(
            select(LoanRequest).where(
                LoanRequest.id == loan_id,
                LoanRequest.business_id == business_id,
            )
        )
        loan = result.scalar_one_or_none()
        if not loan:
            raise NotFoundError("LoanRequest", str(loan_id))
        return loan

    # ── Lender decision ───────────────────────────────────────────────────────

    async def lender_approve(
        self,
        loan_id: UUID,
        lender_id: str,
        amount_approved: Decimal,
        interest_rate: Decimal,
        term_days: int,
        partner_ref: str | None = None,
        lender_webhook_url: str | None = None,
    ) -> LoanRequest:
        """Lender approves a pending loan request."""
        loan = await self._get_loan_for_lender(loan_id, lender_id)
        await self._transition_loan(loan, "approved")

        loan.lender_id = lender_id
        loan.amount_approved = amount_approved
        loan.interest_rate = interest_rate
        loan.term_days = term_days
        loan.decided_at = datetime.now(timezone.utc)
        if partner_ref:
            loan.partner_ref = partner_ref
        if lender_webhook_url:
            loan.lender_webhook_url = lender_webhook_url

        await self.db.flush([loan])
        logger.info("loan.approved", loan_id=str(loan_id), lender_id=lender_id)

        # Send OTP to merchant for confirmation
        await self._send_loan_confirm_otp(loan)
        return loan

    async def lender_reject(
        self,
        loan_id: UUID,
        lender_id: str,
        rejection_reason: str | None = None,
    ) -> LoanRequest:
        """Lender rejects a pending loan request."""
        loan = await self._get_loan_for_lender(loan_id, lender_id)
        await self._transition_loan(loan, "rejected")

        loan.lender_id = lender_id
        loan.decided_at = datetime.now(timezone.utc)
        loan.rejection_reason = rejection_reason

        await self.db.flush([loan])
        logger.info(
            "loan.rejected",
            loan_id=str(loan_id),
            lender_id=lender_id,
            reason=rejection_reason,
        )
        await self._notify_merchant(loan, "rejected")
        return loan

    # ── Merchant confirmation (OTP step) ─────────────────────────────────────

    async def send_loan_confirm_otp(self, loan_id: UUID, business_id: UUID) -> None:
        """Re-send the confirmation OTP for an approved loan."""
        loan = await self.get_loan(loan_id, business_id)
        if loan.status != "approved":
            raise ConflictError(f"Loan is '{loan.status}', not 'approved'")
        await self._send_loan_confirm_otp(loan)

    async def confirm_loan(self, loan_id: UUID, business_id: UUID, otp: str) -> LoanRequest:
        """Merchant confirms they want to proceed with the approved loan via OTP."""
        loan = await self.get_loan(loan_id, business_id)
        await self._transition_loan(loan, "confirmed")

        cache = RedisCache(get_otp_redis(), prefix=_LOAN_OTP_PREFIX)
        stored = await cache.get(str(loan_id))
        if stored is None or not _hmac.compare_digest(str(stored), _hash_otp(otp)):
            raise InvalidOTPError()

        await cache.delete(str(loan_id))
        loan.confirmed_at = datetime.now(timezone.utc)
        await self.db.flush([loan])
        logger.info("loan.confirmed", loan_id=str(loan_id), business_id=str(business_id))
        return loan

    # ── Disbursement (platform_admin + webhook-driven) ────────────────────────

    async def disburse_loan(self, loan_id: UUID, disbursed_by: UUID) -> LoanRequest:
        """
        Initiate MoMo disbursement for a confirmed loan (platform_admin only).
        Delegates to initiate_disbursement() for idempotency.
        """
        return await self.initiate_disbursement(loan_id, disbursed_by=disbursed_by)

    async def initiate_disbursement(
        self, loan_id: UUID, disbursed_by: UUID | None = None
    ) -> LoanRequest:
        """
        Idempotent disbursement initiation.
        Transitions: confirmed → disbursing.
        Stores disbursement_transfer_code for webhook matching.
        Safe to call multiple times — no-op if already disbursing/active.
        """
        result = await self.db.execute(select(LoanRequest).where(LoanRequest.id == loan_id))
        loan = result.scalar_one_or_none()
        if not loan:
            raise NotFoundError("LoanRequest", str(loan_id))

        if loan.status in ("active", "repaid", "defaulted"):
            return loan  # already past disbursement — idempotent no-op
        if loan.status == "disbursing" and loan.disbursement_transfer_code:
            return loan  # already in flight — idempotent no-op

        if loan.status != "confirmed":
            raise ConflictError(
                f"Loan must be in 'confirmed' state to disburse (current: '{loan.status}')"
            )
        if not loan.disbursement_phone or not loan.amount_approved:
            raise ConflictError("Loan is missing disbursement_phone or amount_approved")

        await self._transition_loan(loan, "disbursing", actor_id=disbursed_by)

        transfer_code, payment_ref = await self._trigger_disbursement(loan, disbursed_by)
        loan.disbursement_payment_ref = payment_ref
        loan.disbursement_transfer_code = transfer_code
        await self.db.flush([loan])

        # Write a Payment record so the payment pipeline can track this disbursement
        await self._record_disbursement_payment(loan, transfer_code, payment_ref)

        await self._notify_merchant(loan, "disbursing")
        await audit(
            self.db,
            action="loan.disbursement.initiated",
            resource_type="LoanRequest",
            resource_id=loan.id,
            user_id=disbursed_by,
            after={"transfer_code": transfer_code, "amount": str(loan.amount_approved)},
        )
        logger.info(
            "loan.disbursement.initiated",
            loan_id=str(loan_id),
            transfer_code=transfer_code,
            payment_ref=payment_ref,
        )
        return loan

    async def confirm_disbursement(self, transfer_code: str) -> LoanRequest | None:
        """
        Called by webhook handler on transfer.success.
        Finds loan by disbursement_transfer_code.
        Transitions: disbursing → active.
        Creates repayment schedule, records lender revenue, triggers agent commission.
        Returns None if no matching loan found (may be a non-loan transfer — safe to ignore).
        """
        result = await self.db.execute(
            select(LoanRequest).where(LoanRequest.disbursement_transfer_code == transfer_code)
        )
        loan = result.scalar_one_or_none()
        if not loan:
            return None

        if loan.status == "active":
            return loan  # already confirmed — idempotent

        await self._transition_loan(loan, "active")
        loan.disbursed_at = loan.disbursed_at or datetime.now(timezone.utc)
        await self.db.flush([loan])

        await self._ensure_repayment_schedule(loan)
        await self._record_lender_revenue(loan)
        await self._trigger_agent_first_loan_commission(loan)
        await self._notify_merchant(loan, "disbursed")
        await self._notify_lender_webhook(loan, "loan.disbursed")
        await audit(
            self.db,
            action="loan.disbursement.confirmed",
            resource_type="LoanRequest",
            resource_id=loan.id,
            after={"transfer_code": transfer_code, "disbursed_at": loan.disbursed_at.isoformat()},
        )
        logger.info(
            "loan.disbursement.confirmed",
            loan_id=str(loan.id),
            transfer_code=transfer_code,
        )
        return loan

    async def fail_disbursement(self, transfer_code: str, reason: str) -> LoanRequest | None:
        """
        Called by webhook handler on transfer.failed / transfer.reversed.
        Reverts loan from 'disbursing' back to 'confirmed' so it can be retried.
        Notifies merchant and triggers admin escalation task.
        Returns None if no matching loan found.
        """
        result = await self.db.execute(
            select(LoanRequest).where(LoanRequest.disbursement_transfer_code == transfer_code)
        )
        loan = result.scalar_one_or_none()
        if not loan:
            return None

        if loan.status not in ("disbursing",):
            return loan  # already resolved

        await self._transition_loan(loan, "confirmed")
        await self.db.flush([loan])

        await audit(
            self.db,
            action="loan.disbursement.failed",
            resource_type="LoanRequest",
            resource_id=loan.id,
            after={"transfer_code": transfer_code, "reason": reason},
        )
        logger.warning(
            "loan.disbursement.failed",
            loan_id=str(loan.id),
            transfer_code=transfer_code,
            reason=reason,
        )

        # Notify merchant that disbursement failed but loan is still approved
        try:
            from apps.api.modules.notifications.service import NotificationService

            await NotificationService(self.db).dispatch_event(
                business_id=loan.business_id,
                event_type="loan_status_changed",
                data={
                    "message": (
                        "Your loan disbursement encountered a temporary issue. "
                        "We are retrying automatically. Contact support if this persists."
                    )
                },
            )
        except Exception:
            pass

        return loan

    async def mark_loan_active(self, loan_id: UUID, payment_ref: str | None = None) -> LoanRequest:
        """
        Legacy helper — now delegates to confirm_disbursement() via transfer_code lookup.
        Kept for backward compatibility with existing webhook integrations.
        Transitions: disbursing -> active; creates repayment schedule.
        """
        result = await self.db.execute(select(LoanRequest).where(LoanRequest.id == loan_id))
        loan = result.scalar_one_or_none()
        if not loan:
            raise NotFoundError("LoanRequest", str(loan_id))
        if loan.status != "active":
            await self._transition_loan(loan, "active")

        loan.disbursed_at = loan.disbursed_at or datetime.now(timezone.utc)
        if payment_ref:
            loan.disbursement_payment_ref = payment_ref

        await self.db.flush([loan])
        await self._ensure_repayment_schedule(loan)
        await self._record_lender_revenue(loan)
        await self._trigger_agent_first_loan_commission(loan)
        await self._notify_merchant(loan, "disbursed")
        await self._notify_lender_webhook(loan, "loan.disbursed")
        logger.info("loan.active", loan_id=str(loan_id))
        return loan

    # ── Repayment schedule ────────────────────────────────────────────────────

    async def _generate_repayment_schedule(self, loan: LoanRequest) -> list[RepaymentInstalment]:
        """
        Equal monthly instalments using flat-rate interest:
            total_interest = principal * rate / 100
            instalment     = (principal + total_interest) / num_instalments
        """
        if not loan.amount_approved or not loan.interest_rate or not loan.term_days:
            raise ConflictError("Loan missing required fields to generate schedule")

        principal = loan.amount_approved
        rate = loan.interest_rate
        total_interest = (principal * rate / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        total_due = principal + total_interest
        num_instalments = max(1, loan.term_days // 30)
        instalment_amount = (total_due / Decimal(num_instalments)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        principal_per = (principal / Decimal(num_instalments)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        interest_per = instalment_amount - principal_per

        base_date = loan.disbursed_at or datetime.now(timezone.utc)
        instalments = []
        for i in range(1, num_instalments + 1):
            due = base_date + timedelta(days=30 * i)
            inst = RepaymentInstalment(
                loan_request_id=loan.id,
                instalment_number=i,
                due_date=due,
                amount=instalment_amount,
                principal=principal_per,
                interest=interest_per,
            )
            self.db.add(inst)
            instalments.append(inst)

        await self.db.flush(instalments)
        logger.info(
            "loan.schedule_generated",
            loan_id=str(loan.id),
            instalments=num_instalments,
            total_due=str(total_due),
        )
        return instalments

    async def _ensure_repayment_schedule(self, loan: LoanRequest) -> list[RepaymentInstalment]:
        existing = (
            (
                await self.db.execute(
                    select(RepaymentInstalment).where(
                        RepaymentInstalment.loan_request_id == loan.id
                    )
                )
            )
            .scalars()
            .all()
        )
        if existing:
            return list(existing)
        return await self._generate_repayment_schedule(loan)

    async def _record_lender_revenue(self, loan: LoanRequest) -> None:
        if not loan.lender_id or loan.amount_approved is None:
            return
        from apps.api.modules.lender.models import LenderLoanRevenue

        existing = (
            await self.db.execute(
                select(LenderLoanRevenue).where(LenderLoanRevenue.loan_request_id == loan.id)
            )
        ).scalar_one_or_none()
        if existing:
            return

        rate = Decimal(str(get_settings().LENDER_ORIGINATION_FEE_RATE_PERCENT)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        fee_amount = (loan.amount_approved * rate / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        revenue = LenderLoanRevenue(
            loan_request_id=loan.id,
            business_id=loan.business_id,
            lender_id=loan.lender_id,
            principal_amount=loan.amount_approved,
            fee_rate_percent=rate,
            fee_amount=fee_amount,
            status="earned",
            provider_ref=loan.disbursement_payment_ref,
        )
        self.db.add(revenue)
        await self.db.flush([revenue])

    async def _trigger_agent_first_loan_commission(self, loan: LoanRequest) -> None:
        try:
            from apps.api.modules.agent_network.service import AgentNetworkService

            await AgentNetworkService(self.db).trigger_activation_commission(
                loan.business_id, "first_loan"
            )
        except Exception as exc:
            logger.warning(
                "agent.first_loan_commission_failed", loan_id=str(loan.id), error=str(exc)
            )

    async def get_repayment_schedule(
        self, loan_id: UUID, business_id: UUID
    ) -> list[RepaymentInstalment]:
        loan = await self.get_loan(loan_id, business_id)
        result = await self.db.execute(
            select(RepaymentInstalment)
            .where(RepaymentInstalment.loan_request_id == loan.id)
            .order_by(RepaymentInstalment.instalment_number)
        )
        return list(result.scalars().all())

    # ── Default detection ─────────────────────────────────────────────────────

    async def check_and_mark_defaulted(self, loan: LoanRequest) -> bool:
        """
        If all remaining instalments are defaulted, mark the loan defaulted.
        If all instalments are paid, mark the loan repaid.
        Returns True if the loan was marked defaulted.
        """
        result = await self.db.execute(
            select(RepaymentInstalment).where(
                RepaymentInstalment.loan_request_id == loan.id,
                RepaymentInstalment.status.notin_(["paid"]),
            )
        )
        unpaid = list(result.scalars().all())

        if not unpaid:
            try:
                await self._transition_loan(loan, "repaid")
                loan.repaid_at = datetime.now(timezone.utc)
                await self.db.flush([loan])
                await self._notify_merchant(loan, "repaid")
                await self._notify_lender_webhook(loan, "loan.repaid")
            except ConflictError:
                pass
            return False

        all_defaulted = all(i.status == "defaulted" for i in unpaid)
        if all_defaulted:
            try:
                await self._transition_loan(loan, "defaulted")
            except ConflictError:
                return False
            loan.defaulted_at = datetime.now(timezone.utc)
            await self.db.flush([loan])
            await self._notify_merchant(loan, "defaulted")
            await self._notify_lender_webhook(loan, "loan.defaulted")
            logger.warning("loan.defaulted", loan_id=str(loan.id))
            return True

        return False

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _record_disbursement_payment(
        self, loan: LoanRequest, transfer_code: str, payment_ref: str
    ) -> None:
        """
        Write a Payment record (type=disbursement, status=pending) so the payment
        pipeline can reconcile and track the loan disbursement transfer.
        Idempotent — skips if a Payment with the same internal_ref already exists.
        """
        from apps.api.modules.payments.models import Payment

        existing = (
            await self.db.execute(
                select(Payment).where(Payment.internal_ref == payment_ref)
            )
        ).scalar_one_or_none()
        if existing:
            return  # already recorded — idempotent

        # Detect provider from phone number
        phone = loan.disbursement_phone or ""
        digits = phone.replace("+", "").replace(" ", "")
        if any(digits.startswith(p) for p in ("23324", "23354", "23323", "23353")):
            provider = "mtn"
        elif any(digits.startswith(p) for p in ("23320", "23350")):
            provider = "vodafone"
        elif any(digits.startswith(p) for p in ("23327", "23357", "23326", "23356")):
            provider = "airteltigo"
        else:
            provider = "mtn"

        payment = Payment(
            business_id=loan.business_id,
            type="disbursement",
            provider=provider,
            processor="paystack",
            amount=loan.amount_approved,
            currency="GHS",
            phone=loan.disbursement_phone,
            external_ref=transfer_code,
            internal_ref=payment_ref,
            status="pending",
            metadata_={
                "loan_id": str(loan.id),
                "lender_id": loan.lender_id,
                "payment_type": "loan_disbursement",
            },
        )
        self.db.add(payment)
        await self.db.flush([payment])
        logger.info(
            "loan.disbursement_payment_recorded",
            loan_id=str(loan.id),
            payment_id=str(payment.id),
            transfer_code=transfer_code,
        )

    async def _transition_loan(
        self,
        loan: LoanRequest,
        new_status: str,
        actor_id: UUID | None = None,
    ) -> None:
        before = {"status": loan.status}
        old_status, status = loan.transition(new_status)
        await audit(
            self.db,
            action="loan.transition",
            resource_type="LoanRequest",
            resource_id=loan.id,
            user_id=actor_id,
            business_id=loan.business_id,
            before=before,
            after={"status": status, "previous_status": old_status},
        )

    async def _get_loan_for_lender(self, loan_id: UUID, lender_id: str) -> LoanRequest:
        result = await self.db.execute(select(LoanRequest).where(LoanRequest.id == loan_id))
        loan = result.scalar_one_or_none()
        if not loan:
            raise NotFoundError("LoanRequest", str(loan_id))
        if loan.lender_id and loan.lender_id != lender_id:
            raise ForbiddenError("This loan is assigned to a different lender")
        return loan

    async def _send_loan_confirm_otp(self, loan: LoanRequest) -> None:
        otp = generate_otp()
        cache = RedisCache(get_otp_redis(), prefix=_LOAN_OTP_PREFIX)
        await cache.set(str(loan.id), _hash_otp(otp), ttl=_LOAN_OTP_TTL)
        try:
            from apps.api.modules.auth.models import User
            from apps.api.modules.business.models import BusinessMember
            from apps.api.modules.notifications.service import (
                NotificationDispatcher,
                NotificationMessage,
            )

            owner = (
                await self.db.execute(
                    select(User)
                    .join(BusinessMember, BusinessMember.user_id == User.id)
                    .where(
                        BusinessMember.business_id == loan.business_id,
                        BusinessMember.role == "owner",
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if owner and owner.phone:
                amount = loan.amount_approved or loan.amount_requested
                text = (
                    f"Your SME Flow loan of GHS {amount} is approved. "
                    f"Confirmation code: {otp}. Expires in 10 min. "
                    f"Confirm in the app to receive funds."
                )
                await NotificationDispatcher().send(
                    NotificationMessage(phone=owner.phone, text=text), channel="sms"
                )
        except Exception as exc:
            logger.warning("loan.confirm_otp_send_failed", loan_id=str(loan.id), error=str(exc))

    async def _trigger_disbursement(
        self, loan: LoanRequest, disbursed_by: UUID | None
    ) -> tuple[str, str]:
        """
        Fire the Paystack transfer for a loan disbursement.
        Returns (transfer_code, payment_ref) — both stored on the loan.
        Uses a deterministic reference to ensure idempotency.
        """
        from libs.payment_clients.providers import get_payment_provider

        phone = loan.disbursement_phone or ""
        digits = phone.replace("+", "").replace(" ", "")
        mtn_pfx = ("23324", "23354", "23323", "23353")
        vod_pfx = ("23320", "23350")
        at_pfx = ("23327", "23357", "23326", "23356")

        if any(digits.startswith(p) for p in mtn_pfx):
            provider = "mtn"
        elif any(digits.startswith(p) for p in vod_pfx):
            provider = "vodafone"
        elif any(digits.startswith(p) for p in at_pfx):
            provider = "airteltigo"
        else:
            provider = "mtn"

        client = get_payment_provider(provider)
        # Deterministic reference — Paystack deduplicates by reference
        ref = f"loan-disb-{str(loan.id)[:12]}"
        if not loan.disbursement_phone or loan.amount_approved is None:
            raise ConflictError("Loan is missing disbursement phone or approved amount")

        result = await client.disburse(
            phone=loan.disbursement_phone,
            amount=loan.amount_approved,
            reference=ref,
            description=f"SMEflow loan disbursement {str(loan.id)[:8]}",
        )
        # external_ref is the Paystack transfer_code; ref is our internal payment reference
        transfer_code = result.external_ref or ref
        return transfer_code, ref

    async def _primary_momo_phone(self, business_id: UUID) -> str | None:
        from apps.api.modules.business.models import MoMoAccount

        result = await self.db.execute(
            select(MoMoAccount)
            .where(
                MoMoAccount.business_id == business_id,
                MoMoAccount.is_verified.is_(True),
            )
            .order_by(MoMoAccount.is_primary.desc(), MoMoAccount.created_at)
            .limit(1)
        )
        account = result.scalar_one_or_none()
        return account.phone if account else None

    async def _notify_merchant(self, loan: LoanRequest, event: str) -> None:
        # Fire a multi-channel notification via NotificationService.dispatch_event().
        # Failure must never break the core loan lifecycle.
        try:
            from apps.api.modules.notifications.service import NotificationService

            msg_map = {
                "approved": (
                    f"Your loan of GHS {loan.amount_requested} was approved for "
                    f"GHS {loan.amount_approved}. Confirm via the SME Flow app."
                ),
                "rejected": (
                    f"Your loan request of GHS {loan.amount_requested} was not approved."
                    + (f" Reason: {loan.rejection_reason}." if loan.rejection_reason else "")
                ),
                "disbursing": (
                    f"Your loan of GHS {loan.amount_approved} is being sent to "
                    f"{loan.disbursement_phone}. You will receive an MoMo prompt shortly."
                ),
                "disbursed": (
                    f"GHS {loan.amount_approved} sent to {loan.disbursement_phone}. "
                    f"First repayment due in 30 days."
                ),
                "repaid": "Congratulations! Your SME Flow loan is fully repaid.",
                "defaulted": "Your SME Flow loan is overdue. Contact support immediately.",
            }
            msg = msg_map.get(event, f"Your loan status has been updated to {event}.")
            await NotificationService(self.db).dispatch_event(
                business_id=loan.business_id,
                event_type="loan_status_changed",
                data={"message": msg},
            )
        except Exception as exc:
            logger.warning(
                "notification.dispatch_failed",
                event_type="loan_status_changed",
                loan_id=str(loan.id),
                event=event,
                error=str(exc),
            )

    async def _notify_lender_webhook(self, loan: LoanRequest, event: str) -> None:
        import hashlib
        import hmac
        import time

        import httpx

        from apps.api.modules.lender.models import LenderPartner

        # Resolve webhook URL: per-loan first, then lender-level
        webhook_url = loan.lender_webhook_url
        webhook_secret: str | None = None
        if not webhook_url and loan.lender_id:
            lender_result = await self.db.execute(
                select(LenderPartner).where(LenderPartner.lender_id == loan.lender_id)
            )
            lender_partner = lender_result.scalar_one_or_none()
            if lender_partner:
                webhook_url = lender_partner.webhook_url
                webhook_secret = lender_partner.webhook_secret
        elif loan.lender_id:
            lender_result = await self.db.execute(
                select(LenderPartner).where(LenderPartner.lender_id == loan.lender_id)
            )
            lender_partner = lender_result.scalar_one_or_none()
            if lender_partner:
                webhook_secret = lender_partner.webhook_secret

        if not webhook_url:
            return

        try:
            ts = int(time.time())
            payload = {
                "event": event,
                "partner_ref": loan.partner_ref,
                "loan_id": str(loan.id),
                "status": loan.status,
                "amount": str(loan.amount_approved or loan.amount_requested),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            import json

            json_body = json.dumps(payload)
            headers: dict[str, str] = {"X-SMEFlow-Timestamp": str(ts)}
            if webhook_secret:
                sig = hmac.new(webhook_secret.encode(), json_body.encode(), hashlib.sha256).hexdigest()
                headers["X-SMEFlow-Signature"] = f"sha256={sig}"
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    webhook_url,
                    content=json_body,
                    headers={**headers, "Content-Type": "application/json"},
                )
                if resp.status_code >= 400:
                    logger.warning(
                        "loan.lender_webhook_failed",
                        loan_id=str(loan.id),
                        event=event,
                        status=resp.status_code,
                    )
        except Exception as exc:
            logger.warning(
                "loan.lender_webhook_error",
                loan_id=str(loan.id),
                event=event,
                error=str(exc),
            )
