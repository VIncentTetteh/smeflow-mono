"""
MerchantSettlementService.

Handles:
  credit_collection()           — ledger credit + platform fee on payment confirm
  calculate_fee()               — plan-aware fee calculation
  get_merchant_balance()        — wallet summary for a business
  get_ledger()                  — paginated ledger entries
  ensure_merchant_recipient_code() — Paystack recipient from primary MoMo
  request_settlement()          — merchant withdrawal request with all gates
  approve_settlement()          — admin approval → triggers disbursement
  cancel_settlement()           — cancel a pending request
  confirm_settlement()          — webhook: transfer.success handler
  fail_settlement()             — webhook: transfer.failed/reversed handler
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.modules.settlements.models import MerchantLedgerEntry, MerchantSettlement

logger = structlog.get_logger()

# Platform fee rates by subscription plan
PLATFORM_FEE_RATES: dict[str, Decimal] = {
    "free":    Decimal("0.025"),  # 2.5%
    "starter": Decimal("0.015"),  # 1.5%
    "pro":     Decimal("0.010"),  # 1.0%
}


def _get_settings():
    from apps.api.core.config import get_settings
    return get_settings()


def _min_settlement_ghs() -> Decimal:
    return Decimal(str(_get_settings().SETTLEMENT_MIN_GHS))


def _auto_approve_ceiling_ghs() -> Decimal:
    return Decimal(str(_get_settings().SETTLEMENT_AUTO_APPROVE_CEILING_GHS))


def calculate_fee(amount: Decimal, subscription_plan: str) -> Decimal:
    """Return the platform fee for a given collection amount and merchant plan."""
    rate = PLATFORM_FEE_RATES.get(subscription_plan, PLATFORM_FEE_RATES["free"])
    return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def settlement_payout_amounts(withdrawal_amount: Decimal) -> tuple[Decimal, Decimal]:
    """
    Fee/net for a settlement transfer.

    Platform fee is deducted at ledger credit time only; payout transfers the
    full withdrawal amount (unsettled_balance is already net of collection fees).
    """
    return Decimal("0"), withdrawal_amount


def _fee_rate_percent(plan: str) -> float:
    rate = PLATFORM_FEE_RATES.get(plan, PLATFORM_FEE_RATES["free"])
    return float(rate * 100)


class MerchantSettlementService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _write_audit(
        self,
        action: str,
        *,
        resource_type: str,
        resource_id: UUID,
        business_id: UUID | None = None,
        user_id: UUID | None = None,
        before: dict | None = None,
        after: dict | None = None,
    ) -> None:
        from apps.api.core.audit import audit

        await audit(
            self.db,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id,
            business_id=business_id,
            before=before,
            after=after,
        )

    def _format_ledger_entry(self, entry: MerchantLedgerEntry, plan: str) -> dict:
        """Serialize a ledger row with fee visibility for merchant-facing UI."""
        item = {
            "id": str(entry.id),
            "type": entry.type,
            "amount": str(entry.amount),
            "amount_abs": str(abs(entry.amount)),
            "balance_after": str(entry.balance_after),
            "description": entry.description,
            "payment_id": str(entry.payment_id) if entry.payment_id else None,
            "settlement_id": str(entry.settlement_id) if entry.settlement_id else None,
            "created_at": entry.created_at.isoformat(),
        }
        if entry.type == "fee":
            item["fee_rate_percent"] = _fee_rate_percent(plan)
            item["fee_deducted_ghs"] = str(abs(entry.amount))
        elif entry.type == "credit":
            item["gross_collection_ghs"] = str(entry.amount)
        return item

    # ── Ledger credit (called on charge.success) ──────────────────────────────

    async def credit_collection(self, payment_id: UUID) -> list[MerchantLedgerEntry] | None:
        """
        Credit a merchant's settlement wallet for a confirmed collection payment.

        Creates two ledger entries:
          1. credit  — full collected amount (positive)
          2. fee     — platform fee deduction (negative)

        Updates business.unsettled_balance.
        Idempotent — returns None if ledger entries already exist for this payment.
        """
        from apps.api.modules.business.models import Business
        from apps.api.modules.payments.models import Payment

        # Load the payment
        payment_result = await self.db.execute(
            select(Payment).where(Payment.id == payment_id)
        )
        payment = payment_result.scalar_one_or_none()
        if not payment or payment.type != "collection" or payment.status != "success":
            return None

        # Idempotency — skip if already credited
        existing = await self.db.execute(
            select(MerchantLedgerEntry).where(
                MerchantLedgerEntry.payment_id == payment_id,
                MerchantLedgerEntry.type == "credit",
            )
        )
        if existing.scalar_one_or_none():
            logger.debug(
                "settlement.credit_collection.already_processed",
                payment_id=str(payment_id),
            )
            return None

        # Load business for subscription plan + current balance
        biz_result = await self.db.execute(
            select(Business).where(Business.id == payment.business_id)
        )
        business = biz_result.scalar_one_or_none()
        if not business:
            logger.warning(
                "settlement.credit_collection.business_not_found",
                business_id=str(payment.business_id),
            )
            return None

        amount = payment.amount
        fee = calculate_fee(amount, business.subscription or "free")
        net_credit = amount - fee

        current_balance = business.unsettled_balance or Decimal("0")
        now = datetime.now(timezone.utc)

        # Entry 1: credit (positive)
        balance_after_credit = current_balance + amount
        credit_entry = MerchantLedgerEntry(
            business_id=business.id,
            payment_id=payment_id,
            type="credit",
            amount=amount,
            balance_after=balance_after_credit,
            description=f"Payment received — ref {payment.internal_ref or str(payment_id)[:8]}",
        )
        self.db.add(credit_entry)

        # Entry 2: fee (negative)
        balance_after_fee = balance_after_credit - fee
        plan = business.subscription or "free"
        fee_entry = MerchantLedgerEntry(
            business_id=business.id,
            payment_id=payment_id,
            type="fee",
            amount=-fee,
            balance_after=balance_after_fee,
            description=(
                f"Platform fee ({_fee_rate_percent(plan):.1f}%) — "
                f"GHS {fee} on GHS {amount} collection"
            ),
        )
        self.db.add(fee_entry)

        # Update business balance
        business.unsettled_balance = balance_after_fee

        try:
            await self.db.flush([credit_entry, fee_entry, business])
        except Exception as exc:
            from sqlalchemy.exc import IntegrityError

            if isinstance(exc, IntegrityError):
                logger.debug(
                    "settlement.credit_collection.race_duplicate",
                    payment_id=str(payment_id),
                )
                return None
            raise

        await self._write_audit(
            "settlement.collection_credited",
            resource_type="Payment",
            resource_id=payment_id,
            business_id=business.id,
            after={
                "amount": str(amount),
                "fee": str(fee),
                "fee_rate_percent": _fee_rate_percent(plan),
                "net_credit": str(net_credit),
                "unsettled_balance": str(business.unsettled_balance),
                "plan": plan,
                "ledger_entries": ["credit", "fee"],
            },
        )

        logger.info(
            "settlement.collection_credited",
            payment_id=str(payment_id),
            business_id=str(business.id),
            amount=str(amount),
            fee=str(fee),
            balance=str(business.unsettled_balance),
        )
        return [credit_entry, fee_entry]

    # ── Wallet summary ────────────────────────────────────────────────────────

    async def get_merchant_balance(self, business_id: UUID) -> dict:
        """
        Return settlement wallet summary for a business:
          unsettled_balance, total_settled, settlement_threshold,
          settlement_enabled, last_settled_at, fee_rate, next_auto_settlement_date.
        """
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(
            select(Business).where(Business.id == business_id)
        )
        business = biz_result.scalar_one_or_none()
        if not business:
            from apps.api.core.exceptions import NotFoundError
            raise NotFoundError("Business", str(business_id))

        plan = business.subscription or "free"
        fee_rate = PLATFORM_FEE_RATES.get(plan, PLATFORM_FEE_RATES["free"])

        # Count pending settlements in flight
        pending_count = (
            await self.db.execute(
                select(func.count(MerchantSettlement.id)).where(
                    MerchantSettlement.business_id == business_id,
                    MerchantSettlement.status.in_(["pending", "approved", "processing"]),
                )
            )
        ).scalar_one()

        # Next auto-settlement: tomorrow at 08:00 WAT
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        next_auto = (now + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)

        return {
            "business_id": str(business_id),
            "unsettled_balance": str(business.unsettled_balance or Decimal("0")),
            "total_settled": str(business.total_settled or Decimal("0")),
            "settlement_threshold": str(business.settlement_threshold or Decimal("50.00")),
            "settlement_enabled": business.settlement_enabled,
            "last_settled_at": business.last_settled_at.isoformat() if business.last_settled_at else None,
            "plan": plan,
            "fee_rate_percent": float(fee_rate * 100),
            "pending_settlement_count": pending_count,
            "eligible_for_auto_settlement": (
                business.settlement_enabled
                and (business.unsettled_balance or Decimal("0"))
                >= (business.settlement_threshold or Decimal("50.00"))
                and pending_count == 0
            ),
            "next_auto_settlement_date": next_auto.isoformat(),
            "min_settlement_ghs": str(_min_settlement_ghs()),
            "auto_approve_ceiling_ghs": str(_auto_approve_ceiling_ghs()),
        }

    # ── Ledger ────────────────────────────────────────────────────────────────

    async def get_ledger(
        self,
        business_id: UUID,
        limit: int = 50,
        offset: int = 0,
        entry_type: str | None = None,
    ) -> dict:
        """
        Return paginated ledger entries for a business, newest first.
        Optionally filter by entry type (credit, fee, debit, reversal, adjustment).

        Fee rows include fee_rate_percent and fee_deducted_ghs for merchant transparency.
        """
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(
            select(Business.subscription).where(Business.id == business_id)
        )
        plan = biz_result.scalar_one_or_none() or "free"

        query = select(MerchantLedgerEntry).where(
            MerchantLedgerEntry.business_id == business_id
        )
        count_query = select(func.count(MerchantLedgerEntry.id)).where(
            MerchantLedgerEntry.business_id == business_id
        )

        if entry_type:
            query = query.where(MerchantLedgerEntry.type == entry_type)
            count_query = count_query.where(MerchantLedgerEntry.type == entry_type)

        total = (await self.db.execute(count_query)).scalar_one()
        rows = (
            await self.db.execute(
                query.order_by(MerchantLedgerEntry.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars().all()

        items = [self._format_ledger_entry(e, plan) for e in rows]
        fee_total = sum(
            abs(e.amount) for e in rows if e.type == "fee"
        )
        return {
            "total": total,
            "items": items,
            "fee_rate_percent": _fee_rate_percent(plan),
            "page_fee_total_ghs": str(fee_total) if fee_total else "0",
        }

    async def get_settlement_history(
        self,
        business_id: UUID,
        limit: int = 20,
        offset: int = 0,
        status: str | None = None,
    ) -> dict:
        """Return paginated settlement request history for a business."""
        query = select(MerchantSettlement).where(
            MerchantSettlement.business_id == business_id
        )
        count_query = select(func.count(MerchantSettlement.id)).where(
            MerchantSettlement.business_id == business_id
        )

        if status:
            query = query.where(MerchantSettlement.status == status)
            count_query = count_query.where(MerchantSettlement.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        rows = (
            await self.db.execute(
                query.order_by(MerchantSettlement.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars().all()

        items = [
            {
                "id": str(s.id),
                "amount": str(s.amount),
                "fee_amount": str(s.fee_amount),
                "net_amount": str(s.net_amount),
                "status": s.status,
                "mode": s.mode,
                "destination_phone": s.destination_phone,
                "destination_provider": s.destination_provider,
                "paystack_transfer_code": s.paystack_transfer_code,
                "failure_reason": s.failure_reason,
                "requested_at": s.requested_at.isoformat(),
                "approved_at": s.approved_at.isoformat() if s.approved_at else None,
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            }
            for s in rows
        ]
        return {"total": total, "items": items}

    # ── Paystack recipient ────────────────────────────────────────────────────

    async def ensure_merchant_recipient_code(self, business_id: UUID) -> tuple[str, str, str]:
        """
        Return (recipient_code, phone, provider) for the business's primary verified MoMo.
        Creates the Paystack transfer recipient if not already stored on the business.
        Raises ValueError if no primary verified MoMo account exists.
        """
        from apps.api.modules.business.models import Business, MoMoAccount
        from libs.payment_clients.paystack import PaystackClient

        biz_result = await self.db.execute(
            select(Business).where(Business.id == business_id)
        )
        business = biz_result.scalar_one_or_none()
        if not business:
            from apps.api.core.exceptions import NotFoundError
            raise NotFoundError("Business", str(business_id))

        # Load primary verified MoMo
        momo_result = await self.db.execute(
            select(MoMoAccount).where(
                MoMoAccount.business_id == business_id,
                MoMoAccount.is_primary.is_(True),
                MoMoAccount.is_verified.is_(True),
            ).limit(1)
        )
        momo = momo_result.scalar_one_or_none()
        if not momo:
            raise ValueError(
                "No primary verified MoMo account found. "
                "Please verify your MoMo number in Settings before requesting a settlement."
            )

        # Reuse stored recipient code if valid for this MoMo
        if business.paystack_recipient_code:
            return business.paystack_recipient_code, momo.phone, momo.provider

        client = PaystackClient(provider=momo.provider)
        try:
            recipient_code = await client._get_or_create_recipient(momo.phone)
        finally:
            await client._close()

        business.paystack_recipient_code = recipient_code
        await self.db.flush([business])
        logger.info(
            "settlement.recipient_code_created",
            business_id=str(business_id),
            provider=momo.provider,
        )
        return recipient_code, momo.phone, momo.provider

    # ── Settlement request ────────────────────────────────────────────────────

    async def request_settlement(
        self,
        business_id: UUID,
        amount: Decimal,
        requested_by: UUID,
        mode: str = "manual",
    ) -> MerchantSettlement:
        """
        Create a merchant settlement request with all validation gates:
          1. KYC must be verified
          2. settlement_enabled must be True
          3. amount >= SETTLEMENT_MIN_GHS and <= 50,000
          4. amount <= unsettled_balance
          5. No settlement already in flight
          6. Primary verified MoMo account exists

        Auto-approves and fires transfer if amount <= SETTLEMENT_AUTO_APPROVE_CEILING_GHS.
        Otherwise creates pending request for admin review.
        Platform fee is not re-applied on payout (already deducted at collection).
        """
        min_ghs = _min_settlement_ghs()
        ceiling_ghs = _auto_approve_ceiling_ghs()
        from apps.api.core.exceptions import ConflictError, NotFoundError
        from apps.api.modules.business.models import Business
        from apps.api.modules.kyc.models import KYCVerification

        # Gate 1: KYC verified
        kyc_result = await self.db.execute(
            select(KYCVerification).where(
                KYCVerification.business_id == business_id,
                KYCVerification.status == "verified",
            )
        )
        if not kyc_result.scalar_one_or_none():
            raise ConflictError(
                "KYC verification required before requesting a settlement. "
                "Please complete identity verification in Settings."
            )

        # Load business
        biz_result = await self.db.execute(
            select(Business).where(Business.id == business_id)
        )
        business = biz_result.scalar_one_or_none()
        if not business:
            raise NotFoundError("Business", str(business_id))

        # Gate 2: settlement_enabled
        if not business.settlement_enabled:
            raise ConflictError(
                "Settlements are currently paused for your account. "
                "Please contact support."
            )

        # Gate 3: amount limits
        if amount < min_ghs:
            raise ConflictError(f"Minimum settlement amount is GHS {min_ghs}.")
        if amount > Decimal("50000.00"):
            raise ConflictError("Maximum single settlement amount is GHS 50,000.")

        # Gate 4: sufficient balance
        unsettled = business.unsettled_balance or Decimal("0")
        if amount > unsettled:
            raise ConflictError(
                f"Requested amount (GHS {amount}) exceeds your unsettled balance "
                f"(GHS {unsettled})."
            )

        # Gate 5: no in-flight settlement
        in_flight = (
            await self.db.execute(
                select(func.count(MerchantSettlement.id)).where(
                    MerchantSettlement.business_id == business_id,
                    MerchantSettlement.status.in_(["pending", "approved", "processing"]),
                )
            )
        ).scalar_one()
        if in_flight > 0:
            raise ConflictError(
                "You already have a settlement in progress. "
                "Please wait for it to complete before requesting another."
            )

        # Gate 6: verified MoMo + pre-create recipient code
        recipient_code, phone, provider = await self.ensure_merchant_recipient_code(business_id)

        fee_amount, net_amount = settlement_payout_amounts(amount)

        settlement = MerchantSettlement(
            business_id=business_id,
            requested_by=requested_by,
            amount=amount,
            fee_amount=fee_amount,
            net_amount=net_amount,
            destination_phone=phone,
            destination_provider=provider,
            paystack_reference=None,
            mode=mode,
            status="pending",
        )
        self.db.add(settlement)
        await self.db.flush([settlement])
        settlement.paystack_reference = (
            f"settle-{str(business_id)[:12]}-{str(settlement.id).replace('-', '')[:8]}"
        )
        await self.db.flush([settlement])

        await self._write_audit(
            "settlement.requested",
            resource_type="MerchantSettlement",
            resource_id=settlement.id,
            user_id=requested_by,
            business_id=business_id,
            before={"status": None},
            after={
                "status": "pending",
                "amount": str(amount),
                "payout_fee": str(fee_amount),
                "net_transfer": str(net_amount),
                "mode": mode,
                "auto_approve_ceiling_ghs": str(ceiling_ghs),
            },
        )
        logger.info(
            "settlement.requested",
            settlement_id=str(settlement.id),
            business_id=str(business_id),
            amount=str(amount),
            mode=mode,
        )

        # Auto-approve if at or below ceiling, otherwise queue for admin
        if amount <= ceiling_ghs:
            await self._write_audit(
                "settlement.auto_approved",
                resource_type="MerchantSettlement",
                resource_id=settlement.id,
                business_id=business_id,
                before={"status": "pending"},
                after={
                    "status": "approved",
                    "amount": str(amount),
                    "ceiling_ghs": str(ceiling_ghs),
                },
            )
            settlement = await self._disburse_settlement(
                settlement=settlement,
                business=business,
                recipient_code=recipient_code,
                approved_by=None,
            )
        else:
            await self._write_audit(
                "settlement.pending_review",
                resource_type="MerchantSettlement",
                resource_id=settlement.id,
                user_id=requested_by,
                business_id=business_id,
                before={"status": "pending"},
                after={
                    "status": "pending",
                    "amount": str(amount),
                    "reason": f"exceeds_auto_approve_ceiling_ghs_{ceiling_ghs}",
                },
            )
            await self._notify_settlement(business_id, settlement, "settlement_pending_review")

        return settlement

    async def approve_settlement(
        self, settlement_id: UUID, admin_id: UUID
    ) -> MerchantSettlement:
        """Admin approves a pending settlement → triggers disbursement."""
        from apps.api.core.exceptions import ConflictError, NotFoundError
        from apps.api.modules.business.models import Business

        result = await self.db.execute(
            select(MerchantSettlement).where(MerchantSettlement.id == settlement_id)
        )
        settlement = result.scalar_one_or_none()
        if not settlement:
            raise NotFoundError("MerchantSettlement", str(settlement_id))
        if settlement.status != "pending":
            raise ConflictError(
                f"Settlement is in '{settlement.status}' state — only pending can be approved."
            )

        prior_status = settlement.status
        biz_result = await self.db.execute(
            select(Business).where(Business.id == settlement.business_id)
        )
        business = biz_result.scalar_one_or_none()
        recipient_code, _, _ = await self.ensure_merchant_recipient_code(settlement.business_id)

        await self._write_audit(
            "settlement.approved",
            resource_type="MerchantSettlement",
            resource_id=settlement_id,
            user_id=admin_id,
            business_id=settlement.business_id,
            before={"status": prior_status},
            after={"status": "approved", "amount": str(settlement.amount)},
        )
        settlement = await self._disburse_settlement(
            settlement=settlement,
            business=business,
            recipient_code=recipient_code,
            approved_by=admin_id,
        )
        return settlement

    async def cancel_settlement(
        self, settlement_id: UUID, actor_id: UUID, reason: str = ""
    ) -> MerchantSettlement:
        """Cancel a pending settlement. Usable by merchant (own request) or admin."""
        from apps.api.core.exceptions import ConflictError, NotFoundError

        result = await self.db.execute(
            select(MerchantSettlement).where(MerchantSettlement.id == settlement_id)
        )
        settlement = result.scalar_one_or_none()
        if not settlement:
            raise NotFoundError("MerchantSettlement", str(settlement_id))
        if settlement.status not in ("pending",):
            raise ConflictError(
                f"Cannot cancel a settlement in '{settlement.status}' state."
            )

        prior_status = settlement.status
        settlement.status = "cancelled"
        settlement.failure_reason = reason or "Cancelled by user"
        await self.db.flush([settlement])

        await self._write_audit(
            "settlement.cancelled",
            resource_type="MerchantSettlement",
            resource_id=settlement_id,
            user_id=actor_id,
            business_id=settlement.business_id,
            before={"status": prior_status},
            after={"status": "cancelled", "reason": settlement.failure_reason},
        )
        logger.info("settlement.cancelled", settlement_id=str(settlement_id))
        return settlement

    # ── Webhook handlers ──────────────────────────────────────────────────────

    async def _find_settlement_for_transfer(
        self,
        *,
        paystack_transfer_code: str | None = None,
        reference: str | None = None,
    ) -> MerchantSettlement | None:
        settlement = None
        if paystack_transfer_code:
            result = await self.db.execute(
                select(MerchantSettlement).where(
                    MerchantSettlement.paystack_transfer_code == paystack_transfer_code
                )
            )
            settlement = result.scalar_one_or_none()
        if not settlement and reference:
            result = await self.db.execute(
                select(MerchantSettlement).where(
                    MerchantSettlement.paystack_reference == reference
                )
            )
            settlement = result.scalar_one_or_none()
        if settlement and paystack_transfer_code and not settlement.paystack_transfer_code:
            settlement.paystack_transfer_code = paystack_transfer_code
            await self.db.flush([settlement])
        return settlement

    async def confirm_settlement(
        self,
        paystack_transfer_code: str | None = None,
        *,
        reference: str | None = None,
    ) -> MerchantSettlement | None:
        """
        Called by webhook on transfer.success.
        Transitions: processing → completed.
        Creates debit ledger entry, finalises business balance, notifies merchant.
        Returns None if no matching settlement.
        """
        from apps.api.modules.business.models import Business

        settlement = await self._find_settlement_for_transfer(
            paystack_transfer_code=paystack_transfer_code,
            reference=reference,
        )
        if not settlement:
            return None
        if settlement.status == "completed":
            return settlement  # idempotent

        prior_status = settlement.status
        now = datetime.now(timezone.utc)
        settlement.status = "completed"
        settlement.completed_at = now
        await self.db.flush([settlement])

        # Debit ledger entry — balance was already held in _disburse_settlement
        biz_result = await self.db.execute(
            select(Business).where(Business.id == settlement.business_id)
        )
        business = biz_result.scalar_one_or_none()
        if business:
            # Balance was already deducted on disburse; record the debit entry for audit trail
            balance_snapshot = business.unsettled_balance or Decimal("0")
            debit_entry = MerchantLedgerEntry(
                business_id=settlement.business_id,
                settlement_id=settlement.id,
                type="debit",
                amount=-settlement.amount,
                balance_after=balance_snapshot,
                description=(
                    f"Settlement paid to {settlement.destination_phone} "
                    f"({settlement.destination_provider}) — {settlement.paystack_transfer_code}"
                ),
            )
            self.db.add(debit_entry)
            business.total_settled = (
                (business.total_settled or Decimal("0")) + settlement.net_amount
            )
            business.last_settled_at = now
            await self.db.flush([debit_entry, business])

        await self._write_audit(
            "settlement.completed",
            resource_type="MerchantSettlement",
            resource_id=settlement.id,
            business_id=settlement.business_id,
            before={"status": prior_status},
            after={
                "status": "completed",
                "transfer_code": settlement.paystack_transfer_code,
                "amount": str(settlement.amount),
                "net_amount": str(settlement.net_amount),
            },
        )
        await self._notify_settlement(settlement.business_id, settlement, "settlement_completed")
        logger.info(
            "settlement.completed",
            settlement_id=str(settlement.id),
            transfer_code=settlement.paystack_transfer_code,
        )
        return settlement

    async def fail_settlement(
        self,
        paystack_transfer_code: str | None = None,
        *,
        reference: str | None = None,
        reason: str = "",
    ) -> MerchantSettlement | None:
        """
        Called by webhook on transfer.failed / transfer.reversed.
        Transitions: processing → failed.
        Restores unsettled_balance, notifies merchant.
        Returns None if no matching settlement.
        """
        from apps.api.modules.business.models import Business

        settlement = await self._find_settlement_for_transfer(
            paystack_transfer_code=paystack_transfer_code,
            reference=reference,
        )
        if not settlement:
            return None
        if settlement.status in ("completed", "failed", "cancelled"):
            return settlement  # idempotent

        prior_status = settlement.status
        settlement.status = "failed"
        settlement.failure_reason = reason
        await self.db.flush([settlement])

        # Restore the held balance back to unsettled
        biz_result = await self.db.execute(
            select(Business).where(Business.id == settlement.business_id)
        )
        business = biz_result.scalar_one_or_none()
        if business:
            business.unsettled_balance = (
                (business.unsettled_balance or Decimal("0")) + settlement.amount
            )
            # Reversal ledger entry
            balance_after = business.unsettled_balance
            reversal_entry = MerchantLedgerEntry(
                business_id=settlement.business_id,
                settlement_id=settlement.id,
                type="reversal",
                amount=settlement.amount,
                balance_after=balance_after,
                description=f"Settlement failed — balance restored. Reason: {reason}",
            )
            self.db.add(reversal_entry)
            await self.db.flush([business, reversal_entry])

        await self._write_audit(
            "settlement.failed",
            resource_type="MerchantSettlement",
            resource_id=settlement.id,
            business_id=settlement.business_id,
            before={"status": prior_status},
            after={
                "status": "failed",
                "transfer_code": settlement.paystack_transfer_code,
                "reason": reason,
                "balance_restored": str(settlement.amount),
            },
        )
        await self._notify_settlement(settlement.business_id, settlement, "settlement_failed")
        logger.warning(
            "settlement.failed",
            settlement_id=str(settlement.id),
            reason=reason,
        )
        return settlement

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _disburse_settlement(
        self,
        settlement: MerchantSettlement,
        business: "object | None",
        recipient_code: str,
        approved_by: UUID | None,
    ) -> MerchantSettlement:
        """
        Fire the Paystack transfer and transition settlement to processing.
        Deducts settlement amount from business.unsettled_balance as a hold.
        """
        from libs.payment_clients.paystack import PaystackClient

        prior_status = settlement.status
        now = datetime.now(timezone.utc)
        client = PaystackClient(provider=settlement.destination_provider or "mtn")
        try:
            resp = await client.disburse(
                amount=settlement.net_amount,
                phone=settlement.destination_phone or "",
                reference=settlement.paystack_reference or str(settlement.id),
                description=f"SMEflow settlement — {str(settlement.business_id)[:8]}",
            )
        finally:
            await client._close()

        settlement.status = "processing"
        settlement.approved_by = approved_by
        settlement.approved_at = now
        settlement.paystack_transfer_code = resp.external_ref or settlement.paystack_reference
        await self.db.flush([settlement])

        await self._write_audit(
            "settlement.processing",
            resource_type="MerchantSettlement",
            resource_id=settlement.id,
            user_id=approved_by,
            business_id=settlement.business_id,
            before={"status": prior_status},
            after={
                "status": "processing",
                "paystack_transfer_code": settlement.paystack_transfer_code,
                "net_amount": str(settlement.net_amount),
            },
        )

        # Hold the amount in the balance (restored on failure, finalised on success)
        if business is not None:
            from apps.api.modules.business.models import Business
            if hasattr(business, "unsettled_balance"):
                business.unsettled_balance = max(
                    Decimal("0"),
                    (business.unsettled_balance or Decimal("0")) - settlement.amount,
                )
                await self.db.flush([business])

        await self._notify_settlement(settlement.business_id, settlement, "settlement_processing")
        logger.info(
            "settlement.disbursed",
            settlement_id=str(settlement.id),
            transfer_code=settlement.paystack_transfer_code,
            net=str(settlement.net_amount),
        )
        return settlement

    async def _notify_settlement(
        self, business_id: UUID, settlement: MerchantSettlement, event_type: str
    ) -> None:
        """Fire in-app + SMS notification for a settlement state change."""
        try:
            from apps.api.modules.notifications.service import NotificationService

            phone_hint = (settlement.destination_phone or "")[-4:]
            amount_str = f"GHc {float(settlement.net_amount):.2f}"

            messages: dict[str, str] = {
                "settlement_pending_review": (
                    f"Your withdrawal of {amount_str} is awaiting approval "
                    f"and will be processed shortly."
                ),
                "settlement_processing": (
                    f"Your withdrawal of {amount_str} is on the way to your MoMo "
                    f"wallet ending {phone_hint}. It should arrive within minutes."
                ),
                "settlement_completed": (
                    f"{amount_str} has been sent to your MoMo wallet ending {phone_hint}."
                ),
                "settlement_failed": (
                    f"Your withdrawal of {amount_str} could not be completed. "
                    f"Your balance has been restored. Please try again or contact support."
                ),
            }

            await NotificationService(self.db).dispatch_event(
                business_id=business_id,
                event_type=event_type,
                data={
                    "message": messages.get(event_type, f"Settlement status: {settlement.status}"),
                    "amount": str(settlement.net_amount),
                    "phone_hint": phone_hint,
                    "settlement_id": str(settlement.id),
                    "status": settlement.status,
                },
            )
        except Exception:
            logger.warning(
                "settlement.notification_failed",
                event_type=event_type,
                settlement_id=str(settlement.id),
            )

    # ── Auto-settlement batch preparation ────────────────────────────────────

    async def prepare_auto_settlement_batch(self) -> list[dict]:
        """
        Select all active, KYC-verified merchants eligible for auto-settlement:
          - settlement_enabled = True
          - unsettled_balance >= settlement_threshold
          - No settlement in flight (pending / approved / processing)
          - KYC status = "verified"
          - Has a primary verified MoMo account

        Returns list of dicts ready for bulk processing:
          { business_id, amount, fee, net_amount, recipient_code, phone,
            provider, reference }

        Skips merchants that fail recipient code creation — logs per skip.
        """
        from sqlalchemy import and_, exists

        from apps.api.modules.business.models import Business, MoMoAccount
        from apps.api.modules.kyc.models import KYCVerification

        # In-flight settlement subquery
        in_flight_sq = (
            select(MerchantSettlement.business_id)
            .where(MerchantSettlement.status.in_(["pending", "approved", "processing"]))
            .scalar_subquery()
        )

        # KYC-verified subquery
        kyc_sq = (
            select(KYCVerification.business_id)
            .where(KYCVerification.status == "verified")
            .scalar_subquery()
        )

        # Primary verified MoMo subquery
        momo_sq = (
            select(MoMoAccount.business_id)
            .where(
                MoMoAccount.is_primary.is_(True),
                MoMoAccount.is_verified.is_(True),
            )
            .scalar_subquery()
        )

        result = await self.db.execute(
            select(Business).where(
                Business.is_active.is_(True),
                Business.settlement_enabled.is_(True),
                Business.unsettled_balance >= Business.settlement_threshold,
                Business.id.notin_(in_flight_sq),
                Business.id.in_(kyc_sq),
                Business.id.in_(momo_sq),
            )
        )
        eligible = list(result.scalars().all())

        transfers: list[dict] = []
        skipped: list[str] = []

        for business in eligible:
            try:
                recipient_code, phone, provider = await self.ensure_merchant_recipient_code(
                    business.id
                )
                amount = business.unsettled_balance or Decimal("0")
                fee_amount, net_amount = settlement_payout_amounts(amount)

                transfers.append(
                    {
                        "business_id": str(business.id),
                        "amount": amount,
                        "fee": fee_amount,
                        "net_amount": net_amount,
                        "recipient_code": recipient_code,
                        "phone": phone,
                        "provider": provider,
                        "subscription": business.subscription or "free",
                    }
                )
            except Exception as exc:
                skipped.append(str(business.id))
                logger.warning(
                    "settlement.auto_batch.skip",
                    business_id=str(business.id),
                    reason=str(exc),
                )

        logger.info(
            "settlement.auto_batch.prepared",
            eligible=len(eligible),
            prepared=len(transfers),
            skipped=len(skipped),
        )
        return transfers

    async def get_admin_summary(self) -> dict:
        """
        Platform-level settlement summary for the admin dashboard.
        """
        from apps.api.modules.business.models import Business

        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        settings = _get_settings()

        # Total unsettled across all active businesses
        total_unsettled = (
            await self.db.execute(
                select(func.sum(Business.unsettled_balance)).where(
                    Business.is_active.is_(True)
                )
            )
        ).scalar_one() or Decimal("0")

        merchants_paused = (
            await self.db.execute(
                select(func.count(Business.id)).where(
                    Business.is_active.is_(True),
                    Business.settlement_enabled.is_(False),
                )
            )
        ).scalar_one() or 0

        # Pending admin approvals (above auto-approve ceiling)
        pending_result = await self.db.execute(
            select(
                func.count(MerchantSettlement.id),
                func.sum(MerchantSettlement.amount),
            ).where(MerchantSettlement.status == "pending")
        )
        pending_row = pending_result.one()
        pending_count = pending_row[0] or 0
        pending_amount = pending_row[1] or Decimal("0")

        # Today's completed volume
        today_completed_row = (
            await self.db.execute(
                select(
                    func.count(MerchantSettlement.id),
                    func.sum(MerchantSettlement.net_amount),
                ).where(
                    MerchantSettlement.status == "completed",
                    MerchantSettlement.completed_at >= today_start,
                )
            )
        ).one()
        today_completed_count = today_completed_row[0] or 0
        today_completed = today_completed_row[1] or Decimal("0")

        today_failed_row = (
            await self.db.execute(
                select(
                    func.count(MerchantSettlement.id),
                    func.sum(MerchantSettlement.amount),
                ).where(
                    MerchantSettlement.status == "failed",
                    MerchantSettlement.created_at >= today_start,
                )
            )
        ).one()

        # Platform fees collected today (ledger fee entries)
        today_fees = (
            await self.db.execute(
                select(func.sum(func.abs(MerchantLedgerEntry.amount))).where(
                    MerchantLedgerEntry.type == "fee",
                    MerchantLedgerEntry.created_at >= today_start,
                )
            )
        ).scalar_one() or Decimal("0")

        # Total processing (in-flight)
        processing_result = await self.db.execute(
            select(
                func.count(MerchantSettlement.id),
                func.sum(MerchantSettlement.amount),
            ).where(MerchantSettlement.status.in_(["approved", "processing"]))
        )
        proc_row = processing_result.one()

        mode_breakdown = (
            await self.db.execute(
                select(MerchantSettlement.mode, func.count(MerchantSettlement.id))
                .where(MerchantSettlement.created_at >= today_start)
                .group_by(MerchantSettlement.mode)
            )
        ).all()

        return {
            "total_unsettled_liability_ghs": str(total_unsettled),
            "merchants_settlement_paused_count": merchants_paused,
            "pending_approval_count": pending_count,
            "pending_approval_amount_ghs": str(pending_amount),
            "in_flight_count": proc_row[0] or 0,
            "in_flight_amount_ghs": str(proc_row[1] or Decimal("0")),
            "today_completed_count": today_completed_count,
            "today_completed_volume_ghs": str(today_completed),
            "today_failed_count": today_failed_row[0] or 0,
            "today_failed_amount_ghs": str(today_failed_row[1] or Decimal("0")),
            "today_platform_fees_collected_ghs": str(today_fees),
            "today_settlements_by_mode": {row[0]: row[1] for row in mode_breakdown},
            "config": {
                "min_settlement_ghs": str(_min_settlement_ghs()),
                "auto_approve_ceiling_ghs": str(_auto_approve_ceiling_ghs()),
                "default_threshold_ghs": str(settings.SETTLEMENT_DEFAULT_THRESHOLD_GHS),
            },
            "as_of": now.isoformat(),
        }

    async def list_all_settlements(
        self,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Admin view: all settlements across all merchants, newest first."""
        from apps.api.modules.business.models import Business

        query = (
            select(MerchantSettlement, Business.name)
            .join(Business, Business.id == MerchantSettlement.business_id)
            .order_by(MerchantSettlement.created_at.desc())
        )
        count_query = select(func.count(MerchantSettlement.id))

        if status:
            query = query.where(MerchantSettlement.status == status)
            count_query = count_query.where(MerchantSettlement.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        rows = (await self.db.execute(query.limit(limit).offset(offset))).all()

        items = [
            {
                "id": str(row.MerchantSettlement.id),
                "business_id": str(row.MerchantSettlement.business_id),
                "business_name": row.name,
                "amount": str(row.MerchantSettlement.amount),
                "fee_amount": str(row.MerchantSettlement.fee_amount),
                "net_amount": str(row.MerchantSettlement.net_amount),
                "status": row.MerchantSettlement.status,
                "mode": row.MerchantSettlement.mode,
                "destination_phone": row.MerchantSettlement.destination_phone,
                "destination_provider": row.MerchantSettlement.destination_provider,
                "paystack_transfer_code": row.MerchantSettlement.paystack_transfer_code,
                "failure_reason": row.MerchantSettlement.failure_reason,
                "requested_at": row.MerchantSettlement.requested_at.isoformat(),
                "approved_at": row.MerchantSettlement.approved_at.isoformat() if row.MerchantSettlement.approved_at else None,
                "completed_at": row.MerchantSettlement.completed_at.isoformat() if row.MerchantSettlement.completed_at else None,
            }
            for row in rows
        ]
        return {"total": total, "items": items}

    async def admin_force_settle(
        self,
        business_id: UUID,
        amount: Decimal,
        admin_id: UUID,
    ) -> MerchantSettlement:
        """
        Admin-forced settlement bypassing the auto-approve ceiling check.
        Skips KYC and concurrent-lock gates (admin override).
        Still requires a primary verified MoMo account.
        """
        from apps.api.core.exceptions import ConflictError, NotFoundError
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(
            select(Business).where(Business.id == business_id)
        )
        business = biz_result.scalar_one_or_none()
        if not business:
            raise NotFoundError("Business", str(business_id))

        if amount <= Decimal("0"):
            raise ConflictError("Amount must be greater than zero.")

        unsettled = business.unsettled_balance or Decimal("0")
        if amount > unsettled:
            raise ConflictError(
                f"Amount (GHS {amount}) exceeds unsettled balance (GHS {unsettled})."
            )

        recipient_code, phone, provider = await self.ensure_merchant_recipient_code(business_id)
        fee_amount, net_amount = settlement_payout_amounts(amount)

        settlement = MerchantSettlement(
            business_id=business_id,
            requested_by=admin_id,
            approved_by=admin_id,
            amount=amount,
            fee_amount=fee_amount,
            net_amount=net_amount,
            destination_phone=phone,
            destination_provider=provider,
            paystack_reference=None,
            mode="admin",
            status="pending",
        )
        self.db.add(settlement)
        await self.db.flush([settlement])
        settlement.paystack_reference = (
            f"settle-adm-{str(business_id)[:12]}-{str(settlement.id).replace('-', '')[:8]}"
        )
        await self.db.flush([settlement])

        settlement = await self._disburse_settlement(
            settlement=settlement,
            business=business,
            recipient_code=recipient_code,
            approved_by=admin_id,
        )

        await self._write_audit(
            "settlement.admin_forced",
            resource_type="MerchantSettlement",
            resource_id=settlement.id,
            user_id=admin_id,
            business_id=business_id,
            before={"status": "pending"},
            after={"status": settlement.status, "amount": str(amount), "net": str(net_amount)},
        )
        return settlement

    async def apply_bulk_transfer_outcomes(
        self,
        outcomes: list[dict],
    ) -> int:
        """
        Persist Paystack transfer codes onto auto-settlement rows after bulk_transfer.
        Returns count of settlements updated.
        """
        updated = 0
        for item in outcomes:
            settlement_id_str = item.get("settlement_id")
            if not settlement_id_str:
                continue
            from uuid import UUID

            result = await self.db.execute(
                select(MerchantSettlement).where(
                    MerchantSettlement.id == UUID(settlement_id_str)
                )
            )
            settlement = result.scalar_one_or_none()
            if not settlement:
                continue
            transfer_code = item.get("transfer_code")
            if transfer_code:
                settlement.paystack_transfer_code = transfer_code
            status = item.get("status", "pending")
            if status in ("failed", "reversed"):
                await self.fail_settlement(
                    transfer_code=transfer_code,
                    reference=settlement.paystack_reference,
                    reason=item.get("error") or "Bulk transfer failed",
                )
            else:
                await self.db.flush([settlement])
            updated += 1
        return updated

    async def audit_auto_settlement_initiated(
        self,
        settlement: MerchantSettlement,
        *,
        initiated_by: UUID | None = None,
    ) -> None:
        """Audit record for Beat/manual auto-settlement batch rows."""
        await self._write_audit(
            "settlement.auto_initiated",
            resource_type="MerchantSettlement",
            resource_id=settlement.id,
            user_id=initiated_by,
            business_id=settlement.business_id,
            before={"status": None},
            after={
                "status": settlement.status,
                "amount": str(settlement.amount),
                "mode": settlement.mode,
                "paystack_reference": settlement.paystack_reference,
            },
        )

    async def update_settlement_config(
        self,
        business_id: UUID,
        settlement_enabled: bool | None = None,
        settlement_threshold: Decimal | None = None,
        admin_id: UUID | None = None,
    ) -> dict:
        """Admin: toggle settlement_enabled or update threshold for a merchant."""
        from apps.api.core.exceptions import NotFoundError
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(
            select(Business).where(Business.id == business_id)
        )
        business = biz_result.scalar_one_or_none()
        if not business:
            raise NotFoundError("Business", str(business_id))

        min_ghs = _min_settlement_ghs()
        before_state = {
            "settlement_enabled": business.settlement_enabled,
            "settlement_threshold": str(business.settlement_threshold),
        }
        changes: dict = {}
        if settlement_enabled is not None:
            business.settlement_enabled = settlement_enabled
            changes["settlement_enabled"] = settlement_enabled
        if settlement_threshold is not None:
            if settlement_threshold < min_ghs:
                from apps.api.core.exceptions import ConflictError
                raise ConflictError(
                    f"Threshold cannot be below minimum settlement amount (GHS {min_ghs})."
                )
            business.settlement_threshold = settlement_threshold
            changes["settlement_threshold"] = str(settlement_threshold)

        await self.db.flush([business])

        await self._write_audit(
            "settlement.config_updated",
            resource_type="Business",
            resource_id=business_id,
            user_id=admin_id,
            business_id=business_id,
            before=before_state,
            after={
                "settlement_enabled": business.settlement_enabled,
                "settlement_threshold": str(business.settlement_threshold),
                **changes,
            },
        )
        logger.info(
            "settlement.config_updated",
            business_id=str(business_id),
            changes=changes,
        )
        return {
            "business_id": str(business_id),
            "settlement_enabled": business.settlement_enabled,
            "settlement_threshold": str(business.settlement_threshold),
        }
