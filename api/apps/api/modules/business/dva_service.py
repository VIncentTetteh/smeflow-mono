"""Paystack Dedicated Virtual Account (DVA) provisioning and inbound payment handling."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class DVAService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def provision_for_business(self, business_id: UUID) -> dict | None:
        """
        Idempotently create Paystack customer + DVA for a verified merchant.
        Returns summary dict or None if Paystack is not configured.
        """
        from apps.api.core.config import get_settings
        from apps.api.modules.business.models import Business
        from libs.payment_clients.paystack import PaystackClient

        result = await self.db.execute(select(Business).where(Business.id == business_id))
        business = result.scalar_one_or_none()
        if not business:
            return None

        if business.dva_account_number and business.paystack_customer_code:
            return {
                "business_id": str(business_id),
                "already_provisioned": True,
                "account_number": business.dva_account_number,
                "account_name": business.dva_account_name,
                "bank_name": business.dva_bank_name,
            }

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            logger.warning("dva.provision.paystack_not_configured", business_id=str(business_id))
            return None

        client = PaystackClient()
        try:
            if not business.paystack_customer_code:
                from apps.api.modules.business.models import MoMoAccount

                owner_email = business.email or f"merchant-{str(business_id)[:8]}@smeflow.local"
                momo_result = await self.db.execute(
                    select(MoMoAccount.phone).where(
                        MoMoAccount.business_id == business_id,
                        MoMoAccount.is_primary.is_(True),
                    ).limit(1)
                )
                owner_phone = momo_result.scalar_one_or_none() or "0000000000"
                customer = await client.create_customer(
                    email=owner_email,
                    first_name=business.name[:50] if business.name else "Merchant",
                    last_name="SMEflow",
                    phone=owner_phone,
                )
                business.paystack_customer_code = customer.get("customer_code") or customer.get("code")
                business.paystack_customer_id = customer.get("id")
                await self.db.flush([business])

            if not business.dva_account_number:
                dva = await client.create_dedicated_virtual_account(
                    customer_code=business.paystack_customer_code or "",
                    preferred_bank=settings.PAYSTACK_DVA_PREFERRED_BANK,
                )
                business.dva_id = str(dva.get("id", ""))
                business.dva_account_number = dva.get("account_number", "")
                business.dva_account_name = dva.get("account_name", "")
                business.dva_bank_name = (dva.get("bank") or {}).get("name", "")
                await self.db.flush([business])
        finally:
            await client._close()

        from apps.api.core.audit import audit

        await audit(
            self.db,
            action="dva.provisioned",
            resource_type="Business",
            resource_id=business_id,
            business_id=business_id,
            after={
                "customer_code": business.paystack_customer_code,
                "account_number": business.dva_account_number,
            },
        )
        logger.info(
            "dva.provisioned",
            business_id=str(business_id),
            account_number=business.dva_account_number,
        )
        return {
            "business_id": str(business_id),
            "account_number": business.dva_account_number,
            "bank_name": business.dva_bank_name,
        }

    async def handle_inbound_transfer(self, charge_data: dict) -> None:
        """
        Process charge.success for inbound bank transfer to a merchant DVA.
        Creates a collection Payment if needed and credits settlement ledger.
        """
        from apps.api.modules.business.models import Business
        from apps.api.modules.payments.models import Payment
        from apps.api.modules.settlements.service import MerchantSettlementService

        reference = charge_data.get("reference", "")
        amount_kobo = charge_data.get("amount", 0)
        amount = (Decimal(amount_kobo) / Decimal("100")).quantize(Decimal("0.01"))

        metadata = charge_data.get("metadata") or {}
        business_id_str = metadata.get("business_id")
        customer = charge_data.get("customer") or {}
        customer_code = customer.get("customer_code") or customer.get("id", "")

        business = None
        if business_id_str:
            try:
                bid = UUID(str(business_id_str))
                result = await self.db.execute(select(Business).where(Business.id == bid))
                business = result.scalar_one_or_none()
            except ValueError:
                pass
        if not business and customer_code:
            result = await self.db.execute(
                select(Business).where(Business.paystack_customer_code == str(customer_code))
            )
            business = result.scalar_one_or_none()

        if not business:
            logger.warning("dva.inbound.business_not_found", reference=reference)
            return

        existing = await self.db.execute(
            select(Payment).where(Payment.external_ref == reference)
        )
        payment = existing.scalar_one_or_none()
        if payment and payment.status == "success":
            await MerchantSettlementService(self.db).credit_collection(payment.id)
            return

        if not payment:
            payment = Payment(
                id=uuid4(),
                business_id=business.id,
                type="collection",
                amount=amount,
                status="success",
                provider="paystack",
                channel=charge_data.get("channel") or "dedicated_nuban",
                external_ref=reference,
                internal_ref=f"DVA-{reference[:12]}",
                confirmed_at=datetime.now(timezone.utc),
                metadata_={"source": "dva", "dva": True},
            )
            self.db.add(payment)
            await self.db.flush([payment])

        payment.status = "success"
        payment.confirmed_at = datetime.now(timezone.utc)
        await self.db.flush([payment])
        await MerchantSettlementService(self.db).credit_collection(payment.id)
        logger.info(
            "dva.inbound.credited",
            business_id=str(business.id),
            payment_id=str(payment.id),
            amount=str(amount),
        )
