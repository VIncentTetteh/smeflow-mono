"""
Sales service — the core Saga: Sale → Inventory → Invoice → Payment → Tax accrual → Credit.
All steps are local DB transactions with async event emission for downstream steps.
"""

import base64
import json
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import structlog
from sqlalchemy import case, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.core.audit import audit
from apps.api.core.config import get_settings
from apps.api.core.exceptions import (
    ConflictError,
    LimitExceededError,
    NotFoundError,
    PaymentError,
    SMEFlowError,
    TenantMismatchError,
)
from apps.api.core.idempotency import idempotency_store
from apps.api.core.metrics import record_sale_metric
from apps.api.core.schema import is_missing_column_error, is_missing_table_error
from apps.api.modules.business.models import Business
from apps.api.modules.inventory.service import InventoryService
from apps.api.modules.sales.fraud import FraudDetector
from apps.api.modules.sales.models import Customer, Receivable, Sale, SaleItem
from apps.api.modules.sales.schemas import (
    MomoSaleIntentResponse,
    PaymentIntentResponse,
    SaleCreate,
    SaleRecordResponse,
)
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()
settings = get_settings()


class SalesService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.inventory_svc = InventoryService(db)

    @staticmethod
    def _schema_migration_required() -> SMEFlowError:
        return SMEFlowError(
            "The payment database schema is behind. Apply migrations through 0033 and retry.",
            "SCHEMA_MIGRATION_REQUIRED",
            503,
            details={
                "migration": "0033_payment_channel_tracking",
                "required_columns": ["payments.processor", "payments.channel", "payments.provider_detail"],
            },
        )

    @staticmethod
    def _paystack_error_message(exc: Exception) -> str:
        if isinstance(exc, PaymentError):
            return exc.message
        if isinstance(exc, httpx.HTTPStatusError):
            try:
                message = exc.response.json().get("message")
                if message:
                    return f"Paystack rejected the payment: {message}"
            except Exception as parse_error:
                logger.debug("paystack.error_response_unparseable", error=str(parse_error))
            return f"Paystack rejected the payment (HTTP {exc.response.status_code})."
        if isinstance(exc, httpx.HTTPError):
            return "Paystack could not be reached. Check the connection and retry."
        return str(exc) or "Paystack payment initialization failed."

    async def record_sale(
        self, business_id: UUID, user_id: UUID, data: SaleCreate
    ) -> SaleRecordResponse:
        """
        Full sale saga:
        1. Idempotency check
        2. Upsert customer
        3. Create Sale + SaleItems
        4. Deduct stock per item (atomic)
        5. Create Receivable if credit sale
        6. Emit async events (invoice, payment, tax, credit score)
        """
        if data.payment_method == "momo":
            raise SMEFlowError(
                "MoMo sales must be verified through /sales/momo/intents before a sale is recorded.",
                "MOMO_PAYMENT_VERIFICATION_REQUIRED",
                400,
            )
        if data.payment_method == "paystack":
            raise SMEFlowError(
                "Paystack sales must be verified through /sales/payment-intents.",
                "PAYMENT_VERIFICATION_REQUIRED",
                400,
            )

        # ── 0. Subscription limit ────────────────────────────────────────────
        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        billing = BillingService(self.db)
        month_start = datetime.now(timezone.utc).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        month_count = await self.db.scalar(
            select(func.count(Sale.id)).where(
                Sale.business_id == business_id,
                Sale.created_at >= month_start,
                Sale.status != "voided",
            )
        )
        if not await billing.check_limit(business_id, "sale_limit", month_count or 0):
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("sale_limit", 0)
            raise LimitExceededError("monthly sales", limit)
        total_sale_count = await self.db.scalar(
            select(func.count(Sale.id)).where(
                Sale.business_id == business_id,
                Sale.status != "voided",
            )
        )
        is_first_sale = (total_sale_count or 0) == 0

        # ── 1. Idempotency ──────────────────────────────────────────────────
        cached = await idempotency_store.get(business_id, data.idempotency_key)
        if cached:
            logger.info("sales.idempotent_hit", key=data.idempotency_key)
            return SaleRecordResponse(**cached)

        # ── 2. Upsert customer ──────────────────────────────────────────────
        customer_id = None
        if data.customer_phone or data.customer_name:
            customer_id = await self._upsert_customer(
                business_id,
                data.customer_phone,
                data.customer_name,
                reminder_consent=data.reminder_consent,
                reminder_channel=data.reminder_channel,
            )

        # ── 3. Compute totals ───────────────────────────────────────────────
        item_lines = await self._resolve_items(business_id, data.items)
        subtotal = sum(line["line_total"] for line in item_lines)
        total = max(subtotal - data.discount_amount, Decimal("0"))
        fraud = await FraudDetector(self.db).check_sale(business_id, total)
        if fraud.blocked:
            raise SMEFlowError(
                "Sale blocked for manual fraud review",
                "FRAUD_REVIEW_REQUIRED",
                403,
                details={"reasons": fraud.reasons},
            )
        # ── Split payment resolution ─────────────────────────────────────────
        if data.payment_method == "mixed" and data.payment_splits:
            split_total = sum(leg.amount for leg in data.payment_splits)
            if split_total != total:
                # Allow minor rounding tolerance (±0.01)
                if abs(split_total - total) > Decimal("0.01"):
                    raise SMEFlowError(
                        f"Payment splits sum to {split_total} but sale total is {total}",
                        "SPLIT_AMOUNT_MISMATCH",
                        400,
                    )
            cash_legs = [leg for leg in data.payment_splits if leg.method == "cash"]
            momo_legs = [leg for leg in data.payment_splits if leg.method == "momo"]
            amount_paid = sum(leg.amount for leg in cash_legs)
            # MoMo legs are 'pending' until confirmed via webhook
            balance_due = sum(leg.amount for leg in momo_legs)
            sale_status = "partial_payment"
        else:
            amount_paid = total if data.payment_method in ("cash", "ghqr") else Decimal("0")
            balance_due = total - amount_paid
            sale_status = {
                "cash": "completed",
                "ghqr": "completed",
                "credit": "credit",
                "momo": "pending_payment",
            }.get(data.payment_method, "pending")

        # ── 4. Persist Sale ─────────────────────────────────────────────────
        sale = Sale(
            business_id=business_id,
            customer_id=customer_id,
            recorded_by=user_id,
            status=sale_status,
            payment_method=data.payment_method,
            subtotal=subtotal,
            discount_amount=data.discount_amount,
            total=total,
            amount_paid=amount_paid,
            balance_due=balance_due,
            notes=data.notes,
            idempotency_key=data.idempotency_key,
            client_created_at=data.client_created_at,
        )
        self.db.add(sale)
        await self.db.flush([sale])

        # ── 5. SaleItems + Stock deduction ───────────────────────────────────
        for line in item_lines:
            si = SaleItem(
                sale_id=sale.id,
                item_id=line.get("item_id"),
                description=line["description"],
                qty=line["qty"],
                unit_price=line["unit_price"],
                discount=line["discount"],
                line_total=line["line_total"],
                cost_price=line.get("cost_price"),
            )
            self.db.add(si)

            if line.get("item_id"):
                await self.inventory_svc.deduct_stock_for_sale(
                    business_id, line["item_id"], line["qty"], sale.id, user_id
                )

        # ── 6. Receivable for credit sales ───────────────────────────────────
        if data.payment_method == "credit" and balance_due > 0:
            rec = Receivable(
                business_id=business_id,
                sale_id=sale.id,
                customer_id=customer_id,
                amount=balance_due,
                balance_due=balance_due,
                due_date=datetime.combine(data.credit_due_date, time.min, tzinfo=timezone.utc),
            )
            self.db.add(rec)

        await self.db.flush()
        await audit(
            self.db,
            "sale.create",
            "Sale",
            sale.id,
            user_id,
            business_id,
            after={"total": str(total), "payment_method": data.payment_method},
        )

        # ── 7. Async downstream events ───────────────────────────────────────
        payment_request_id = None
        if data.payment_method == "momo":
            payment_request_id = await self._create_momo_payment(
                business_id=business_id,
                sale_id=sale.id,
                amount=total,
                phone=data.customer_phone or "",
                provider=data.payment_provider or "mtn",
                idempotency_key=f"sale:{sale.id}:momo",
            )
        elif data.payment_method == "mixed" and data.payment_splits:
            # Initiate a MoMo request for each MoMo leg in the split
            for idx, leg in enumerate(data.payment_splits):
                if leg.method == "momo":
                    pid = await self._create_momo_payment(
                        business_id=business_id,
                        sale_id=sale.id,
                        amount=leg.amount,
                        phone=leg.phone or "",
                        provider=leg.provider or data.payment_provider or "mtn",
                        idempotency_key=f"sale:{sale.id}:momo:{idx}",
                    )
                    if payment_request_id is None:
                        payment_request_id = pid  # return first MoMo leg ID

        invoice_id = await self._trigger_async_tasks(sale, business_id)
        self._queue_sale_notification(business_id, sale)
        self._queue_credit_score_recalculation(business_id)

        result = SaleRecordResponse(
            sale_id=sale.id,
            invoice_id=invoice_id,
            payment_request_id=str(payment_request_id) if payment_request_id else None,
            total=sale.total,
            balance_due=sale.balance_due,
        )

        # Cache for idempotency
        await idempotency_store.set(
            business_id, data.idempotency_key, result.model_dump(mode="json")
        )
        logger.info("sale.recorded", sale_id=str(sale.id), total=str(total))
        await self._record_metrics(business_id, sale)
        if is_first_sale:
            await self._trigger_first_sale_commission(business_id)
        return result

    async def create_paystack_sale_intent(
        self,
        business_id: UUID,
        user_id: UUID | None,
        data: SaleCreate,
        *,
        callback_url: str | None = None,
        source: str | None = None,
    ) -> PaymentIntentResponse:
        if data.payment_method != "paystack":
            raise SMEFlowError(
                "Only Paystack sales can create Paystack payment intents.",
                "INVALID_PAYMENT_METHOD",
                400,
            )
        try:
            await self.release_expired_stock_reservations()
        except ProgrammingError as exc:
            if is_missing_table_error(exc, "stock_reservations"):
                raise self._schema_migration_required() from exc
            raise
        cache_key = f"paystack-intent:{data.idempotency_key}"
        cached = await idempotency_store.get(business_id, cache_key)
        if cached:
            return PaymentIntentResponse(**cached)

        item_lines = await self._resolve_items(business_id, data.items)
        subtotal = sum(line["line_total"] for line in item_lines)
        total = max(subtotal - data.discount_amount, Decimal("0"))
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
        reference = f"sale-paystack-{uuid4()}"

        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.paystack import PaystackClient

        payment = Payment(
            business_id=business_id,
            type="collection",
            provider="paystack",
            processor="paystack",
            amount=total,
            phone=data.customer_phone,
            internal_ref=reference,
            external_ref=reference,
            status="pending",
            idempotency_key=cache_key,
            metadata_={
                "intent_type": "sale_paystack",
                "sale_data": data.model_dump(mode="json"),
                "user_id": str(user_id) if user_id else None,
                "source": source,
                "expires_at": expires_at.isoformat(),
            },
        )
        self.db.add(payment)
        try:
            await self.db.flush([payment])
        except ProgrammingError as exc:
            if is_missing_column_error(
                exc, "payments", ("processor", "channel", "provider_detail")
            ):
                raise self._schema_migration_required() from exc
            raise
        await self._reserve_stock_for_intent(business_id, payment.id, item_lines, expires_at)

        email = PaystackClient.transaction_email(reference)
        try:
            initialized = await PaystackClient().initialize_transaction(
                email,
                total,
                reference,
                metadata={
                    "intent_type": "sale_paystack",
                    "payment_id": str(payment.id),
                    "business_id": str(business_id),
                    "source": source,
                },
                callback_url=callback_url,
            )
            payment_url = initialized.get("authorization_url")
            if not payment_url:
                raise PaymentError(
                    "Paystack did not return a checkout URL. Please retry.", "paystack"
                )
        except Exception as exc:
            payment.status = "failed"
            payment.provider_message = self._paystack_error_message(exc)
            await self._release_reservations(payment.id)
            await self.db.flush([payment])
            if isinstance(exc, PaymentError):
                raise
            raise PaymentError(payment.provider_message, "paystack") from exc

        payment.external_ref = initialized.get("reference") or reference
        payment.metadata_ = {**payment.metadata_, "payment_url": payment_url}
        await self.db.flush([payment])
        result = self._paystack_intent_response(payment)
        await idempotency_store.set(business_id, cache_key, result.model_dump(mode="json"))
        return result

    async def get_paystack_sale_intent(
        self, business_id: UUID, payment_id: UUID
    ) -> PaymentIntentResponse:
        payment = await self._get_payment_intent(business_id, payment_id, "sale_paystack")
        return self._paystack_intent_response(payment)

    async def verify_paystack_sale_intent(
        self, business_id: UUID, payment_id: UUID
    ) -> PaymentIntentResponse:
        payment = await self._get_payment_intent(business_id, payment_id, "sale_paystack")
        if payment.sale_id:
            return self._paystack_intent_response(payment)
        now = datetime.now(timezone.utc)
        expires_at = self._intent_expires_at(payment)
        if expires_at and expires_at <= now and payment.status != "success":
            payment.status = "failed"
            payment.provider_message = "Paystack checkout expired"
            await self._release_reservations(payment.id)
        elif payment.external_ref:
            from libs.payment_clients.paystack import PaystackClient

            details = await PaystackClient().verify_transaction_details(payment.external_ref)
            payment.status = details["status"]
            payment.processor = "paystack"
            payment.channel = details.get("channel")
            payment.provider_detail = details.get("provider_detail")
            if payment.status == "success":
                payment.confirmed_at = now
            elif payment.status in {"failed", "reversed"}:
                await self._release_reservations(payment.id)
        await self.db.flush([payment])
        if payment.status == "success":
            await self.finalize_verified_payment_intent(payment.id, business_id)
        return self._paystack_intent_response(payment)

    def _paystack_intent_response(self, payment: object) -> PaymentIntentResponse:
        from libs.qr_generator.ghqr import generate_qr_image_bytes

        metadata = getattr(payment, "metadata_", None) or {}
        payment_url = metadata.get("payment_url")
        qr_image_url = None
        if payment_url:
            try:
                encoded = base64.b64encode(generate_qr_image_bytes(payment_url)).decode("ascii")
                qr_image_url = f"data:image/png;base64,{encoded}"
            except Exception:
                logger.warning("paystack.intent.qr_generation_failed", payment_id=str(payment.id))
        return PaymentIntentResponse(
            payment_id=payment.id,
            external_ref=payment.external_ref,
            status=payment.status,
            total=payment.amount,
            expires_at=self._intent_expires_at(payment),
            provider_message=payment.provider_message,
            sale_id=payment.sale_id,
            balance_due=Decimal("0") if payment.sale_id else payment.amount,
            payment_url=payment_url,
            qr_image_url=qr_image_url,
            channel=payment.channel,
            provider_detail=payment.provider_detail,
            message="Payment verified" if payment.sale_id else "Waiting for customer payment",
        )

    async def create_momo_sale_intent(
        self, business_id: UUID, user_id: UUID, data: SaleCreate
    ) -> MomoSaleIntentResponse:
        if data.payment_method != "momo":
            raise SMEFlowError(
                "Only MoMo sales can create MoMo payment intents.", "INVALID_PAYMENT_METHOD", 400
            )
        if not data.customer_phone:
            raise SMEFlowError(
                "customer_phone is required for MoMo payment intents.",
                "CUSTOMER_PHONE_REQUIRED",
                400,
            )

        try:
            await self.release_expired_stock_reservations()
        except ProgrammingError as exc:
            if is_missing_table_error(exc, "stock_reservations"):
                raise SMEFlowError(
                    "Database migration required before MoMo checkout can continue.",
                    "SCHEMA_MIGRATION_REQUIRED",
                    503,
                    details={
                        "missing_tables": ["stock_reservations"],
                        "migration": "0031_stock_reservations",
                    },
                ) from exc
            raise

        cached = await idempotency_store.get(business_id, f"momo-intent:{data.idempotency_key}")
        if cached:
            return MomoSaleIntentResponse(**cached)

        item_lines = await self._resolve_items(business_id, data.items)
        subtotal = sum(line["line_total"] for line in item_lines)
        total = max(subtotal - data.discount_amount, Decimal("0"))
        fraud = await FraudDetector(self.db).check_sale(business_id, total)
        if fraud.blocked:
            raise SMEFlowError(
                "Sale blocked for manual fraud review",
                "FRAUD_REVIEW_REQUIRED",
                403,
                details={"reasons": fraud.reasons},
            )

        from apps.api.modules.payments.models import Payment

        expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        reference = f"sale-intent-{uuid4()}"
        provider = data.payment_provider or "mtn"
        payment = Payment(
            business_id=business_id,
            type="collection",
            provider=provider,
            processor="paystack",
            amount=total,
            phone=data.customer_phone,
            internal_ref=reference,
            status="pending",
            idempotency_key=f"momo-intent:{data.idempotency_key}",
            metadata_={
                "intent_type": "sale_momo",
                "sale_data": data.model_dump(mode="json"),
                "user_id": str(user_id),
                "expires_at": expires_at.isoformat(),
            },
        )
        self.db.add(payment)
        await self.db.flush([payment])
        await self._reserve_stock_for_intent(business_id, payment.id, item_lines, expires_at)

        try:
            from libs.payment_clients.paystack import PaystackClient

            client = PaystackClient(provider)
            response = await client.request_payment(
                total, data.customer_phone, reference, "SMEFlow sale payment"
            )
            if not response.external_ref:
                raise SMEFlowError(
                    "Paystack did not return a payment reference.",
                    "PAYSTACK_REFERENCE_MISSING",
                    502,
                )
            payment.external_ref = response.external_ref
            payment.status = response.status
            payment.provider_message = response.provider_message
            if response.status == "failed":
                await self._release_reservations(payment.id)
                raise SMEFlowError(
                    response.provider_message or "Paystack payment prompt failed.",
                    "PAYSTACK_PROMPT_FAILED",
                    502,
                )
            await self.db.flush([payment])
        except Exception as exc:
            await self._release_reservations(payment.id)
            payment.status = "failed"
            await self.db.flush([payment])
            if isinstance(exc, httpx.HTTPStatusError):
                try:
                    body = exc.response.json()
                    msg = (
                        body.get("data", {}).get("message")
                        or body.get("message")
                        or "Payment provider declined the request."
                    )
                except Exception:
                    msg = "Payment provider returned an unexpected error."
                raise PaymentError(msg, provider) from exc
            raise

        result = MomoSaleIntentResponse(
            payment_id=payment.id,
            external_ref=payment.external_ref,
            status=payment.status,
            total=payment.amount,
            expires_at=expires_at,
            provider_message=payment.provider_message,
        )
        await idempotency_store.set(
            business_id,
            f"momo-intent:{data.idempotency_key}",
            result.model_dump(mode="json"),
        )
        return result

    async def get_momo_sale_intent(
        self, business_id: UUID, payment_id: UUID
    ) -> MomoSaleIntentResponse:
        payment = await self._get_momo_intent_payment(business_id, payment_id)
        sale_id = payment.sale_id
        return MomoSaleIntentResponse(
            payment_id=payment.id,
            external_ref=payment.external_ref,
            status=payment.status,
            total=payment.amount,
            expires_at=self._intent_expires_at(payment),
            provider_message=payment.provider_message,
            sale_id=sale_id,
            balance_due=Decimal("0") if sale_id else payment.amount,
            message="Payment verified" if sale_id else "Waiting for customer approval",
        )

    async def verify_momo_sale_intent(
        self, business_id: UUID, payment_id: UUID
    ) -> MomoSaleIntentResponse:
        payment = await self._get_momo_intent_payment(business_id, payment_id)
        if payment.sale_id:
            return await self.get_momo_sale_intent(business_id, payment_id)

        expires_at = self._intent_expires_at(payment)
        now = datetime.now(timezone.utc)
        if expires_at and expires_at <= now and payment.status != "success":
            payment.status = "failed"
            payment.provider_message = "MoMo payment prompt expired"
            await self._release_reservations(payment.id)
            await self.db.flush([payment])
            return await self.get_momo_sale_intent(business_id, payment_id)

        if payment.external_ref:
            from libs.payment_clients.paystack import PaystackClient

            status = await PaystackClient(payment.provider).check_status(payment.external_ref)
            payment.status = status
            payment.processor = "paystack"
            if status == "success":
                payment.confirmed_at = now
            elif status in {"failed", "reversed"}:
                await self._release_reservations(payment.id)
            await self.db.flush([payment])

        if payment.status == "success":
            sale_record = await self.finalize_verified_momo_sale(payment.id, business_id)
            return MomoSaleIntentResponse(
                payment_id=payment.id,
                external_ref=payment.external_ref,
                status="success",
                total=payment.amount,
                expires_at=expires_at,
                provider_message=payment.provider_message,
                sale_id=sale_record.sale_id,
                invoice_id=sale_record.invoice_id,
                balance_due=Decimal("0"),
                message="Sale recorded after verified MoMo payment",
            )

        return await self.get_momo_sale_intent(business_id, payment_id)

    async def finalize_verified_momo_sale(
        self, payment_id: UUID, business_id: UUID | None = None
    ) -> SaleRecordResponse:
        return await self.finalize_verified_payment_intent(payment_id, business_id)

    async def finalize_verified_payment_intent(
        self, payment_id: UUID, business_id: UUID | None = None
    ) -> SaleRecordResponse:
        from apps.api.modules.payments.models import Payment

        result = await self.db.execute(select(Payment).where(Payment.id == payment_id))
        payment = result.scalar_one_or_none()
        if not payment:
            raise NotFoundError("Payment", str(payment_id))
        if business_id and payment.business_id != business_id:
            raise TenantMismatchError()
        if payment.sale_id:
            from apps.api.modules.settlements.service import MerchantSettlementService

            await MerchantSettlementService(self.db).credit_collection(payment.id)
            sale = await self._get_sale(payment.business_id, payment.sale_id)
            return SaleRecordResponse(
                sale_id=sale.id,
                invoice_id=None,
                payment_request_id=str(payment.id),
                total=sale.total,
                balance_due=sale.balance_due,
                message="Sale already recorded",
            )
        if payment.status != "success":
            raise ConflictError("Cannot record sale until the payment is verified.")

        metadata = payment.metadata_ or {}
        intent_type = metadata.get("intent_type")
        if intent_type not in {"sale_momo", "sale_paystack"}:
            raise ConflictError("Payment is not a sale payment intent.")
        data = SaleCreate.model_validate(metadata.get("sale_data") or {})
        raw_uid = metadata.get("user_id")
        user_id = UUID(str(raw_uid)) if raw_uid else None  # None for guest/storefront orders
        item_lines = await self._resolve_items(payment.business_id, data.items)
        subtotal = sum(line["line_total"] for line in item_lines)
        total = max(subtotal - data.discount_amount, Decimal("0"))

        customer_id = None
        if data.customer_phone or data.customer_name:
            customer_id = await self._upsert_customer(
                payment.business_id, data.customer_phone, data.customer_name
            )

        sale = Sale(
            business_id=payment.business_id,
            customer_id=customer_id,
            recorded_by=user_id,
            status="completed",
            payment_method="paystack" if intent_type == "sale_paystack" else "momo",
            subtotal=subtotal,
            discount_amount=data.discount_amount,
            total=total,
            amount_paid=total,
            balance_due=Decimal("0"),
            notes=data.notes,
            idempotency_key=data.idempotency_key,
            client_created_at=data.client_created_at,
        )
        self.db.add(sale)
        await self.db.flush([sale])

        for line in item_lines:
            self.db.add(
                SaleItem(
                    sale_id=sale.id,
                    item_id=line.get("item_id"),
                    description=line["description"],
                    qty=line["qty"],
                    unit_price=line["unit_price"],
                    discount=line["discount"],
                    line_total=line["line_total"],
                    cost_price=line.get("cost_price"),
                )
            )
            if line.get("item_id"):
                await self.inventory_svc.deduct_stock_for_sale(
                    payment.business_id, line["item_id"], line["qty"], sale.id, user_id
                )

        payment.sale_id = sale.id
        await self._complete_reservations(payment.id)
        await audit(
            self.db,
            "sale.create",
            "Sale",
            sale.id,
            user_id,
            payment.business_id,
            after={
                "total": str(total),
                "payment_method": "paystack" if intent_type == "sale_paystack" else "momo",
                "payment_id": str(payment.id),
            },
        )
        invoice_id = await self._trigger_async_tasks(sale, payment.business_id)
        self._queue_sale_notification(payment.business_id, sale)
        self._queue_credit_score_recalculation(payment.business_id)
        await self._record_metrics(payment.business_id, sale)
        await self.db.flush([sale, payment])
        from apps.api.modules.settlements.service import MerchantSettlementService

        await MerchantSettlementService(self.db).credit_collection(payment.id)

        # Storefront orders: alert the owner (bell + live SSE) that a new online
        # order was paid. Best-effort — never fail the sale on a notification error.
        if metadata.get("source") == "storefront":
            try:
                await self._notify_storefront_order(payment.business_id, sale, data)
            except Exception as exc:  # noqa: BLE001
                logger.warning("storefront.notify_failed", error=str(exc))

        return SaleRecordResponse(
            sale_id=sale.id,
            invoice_id=invoice_id,
            payment_request_id=str(payment.id),
            total=sale.total,
            balance_due=sale.balance_due,
            message="Sale recorded after verified payment",
        )

    async def _notify_storefront_order(self, business_id: UUID, sale, data) -> None:
        """Owner alert (persistent bell + live SSE) for a paid storefront order."""
        who = getattr(data, "customer_name", None) or getattr(data, "customer_phone", None) or "a customer"
        title = "New storefront order"
        message = f"Paid order of GH₵{sale.total} from {who}."
        from apps.api.modules.notifications.alert_service import MerchantAlertService

        await MerchantAlertService(self.db).upsert_alert(
            business_id=business_id,
            alert_type="storefront_order",
            severity="info",
            dedupe_key=f"storefront_order:{sale.id}",
            title=title,
            message=message,
            resource_type="sale",
            resource_id=str(sale.id),
            action_path="/store/sales",
            action_label="View order",
        )
        # Live SSE nudge (fire-and-forget)
        try:
            import redis.asyncio as aioredis

            from apps.api.core.config import get_settings

            r = await aioredis.from_url(get_settings().REDIS_URL)
            payload = json.dumps(
                {"business_id": str(business_id), "event_type": "storefront_order", "message": message}
            )
            await r.publish(f"notifications:{business_id}", payload)
            await r.aclose()
        except Exception as exc:  # noqa: BLE001
            logger.warning("storefront.sse_publish_failed", error=str(exc))

    async def _trigger_first_sale_commission(self, business_id: UUID) -> None:
        try:
            from apps.api.modules.agent_network.service import AgentNetworkService

            await AgentNetworkService(self.db).trigger_activation_commission(
                business_id, "first_sale"
            )
        except Exception as exc:
            logger.warning(
                "agent.first_sale_commission_failed",
                business_id=str(business_id),
                error=str(exc),
            )

    async def void_sale(self, business_id: UUID, sale_id: UUID, user_id: UUID) -> Sale:
        """Void a sale: restore stock, cancel invoice (compensating transaction)."""
        sale = await self._get_sale(business_id, sale_id)
        if sale.status == "voided":
            raise ConflictError("Sale is already voided")

        # Restore stock for each item
        for si in sale.items:
            if si.item_id:
                await self.inventory_svc.adjust_stock(
                    business_id,
                    user_id,
                    type(
                        "Adj",
                        (),
                        {  # type: ignore[call-arg]
                            "item_id": si.item_id,
                            "qty_change": si.qty,
                            "reason": "adjustment",
                            "unit_cost": None,
                            "notes": f"Sale {sale_id} voided",
                            "client_created_at": None,
                        },
                    )(),
                )

        sale.status = "voided"
        await self.db.flush([sale])
        await audit(self.db, "sale.void", "Sale", sale.id, user_id, business_id)

        # Async: void invoice, notify
        try:
            from apps.api.workers.tasks.sales_tasks import void_sale_async

            enqueue_task(void_sale_async, str(sale.id))
        except Exception as e:
            logger.warning("sale.void_async_task_failed", sale_id=str(sale.id), error=str(e))

        return sale

    async def record_payment(
        self,
        business_id: UUID,
        sale_id: UUID,
        amount: Decimal,
        user_id: UUID,
        payment_method: str = "cash",
        notes: str | None = None,
    ) -> Sale:
        """Record a partial/full payment against a credit sale."""
        sale = await self._get_sale(business_id, sale_id)
        if sale.status == "voided":
            raise ConflictError("Cannot record payment on voided sale")
        if amount > sale.balance_due:
            raise SMEFlowError(
                "Payment amount cannot exceed the outstanding balance.",
                "REPAYMENT_EXCEEDS_BALANCE",
                422,
                details={"balance_due": str(sale.balance_due)},
            )

        sale.amount_paid = min(sale.amount_paid + amount, sale.total)
        sale.balance_due = max(sale.total - sale.amount_paid, Decimal("0"))
        if sale.balance_due == 0:
            sale.status = "completed"

        # Update receivable
        if sale.receivable:
            sale.receivable.amount_paid = min(
                sale.receivable.amount_paid + amount, sale.receivable.amount
            )
            sale.receivable.balance_due = max(
                sale.receivable.amount - sale.receivable.amount_paid, Decimal("0")
            )
            sale.receivable.status = "settled" if sale.balance_due == 0 else "partial"

        from apps.api.modules.invoicing.models import Invoice

        invoice = await self.db.scalar(select(Invoice).where(Invoice.sale_id == sale.id))
        if invoice:
            invoice.amount_paid = sale.amount_paid
            invoice.balance_due = sale.balance_due
            if sale.balance_due == 0:
                invoice.status = "paid"
                invoice.paid_at = datetime.now(timezone.utc)

        from apps.api.modules.payments.models import Payment

        self.db.add(
            Payment(
                business_id=business_id,
                invoice_id=invoice.id if invoice else None,
                sale_id=sale.id,
                type="collection",
                provider=payment_method,
                processor="manual",
                channel=payment_method,
                amount=amount,
                status="success",
                confirmed_at=datetime.now(timezone.utc),
                metadata_={"notes": notes} if notes else {},
            )
        )

        await self.db.flush()
        await audit(
            self.db,
            "sale.payment_recorded",
            "Sale",
            sale.id,
            user_id,
            business_id,
            after={"amount_paid": str(sale.amount_paid), "balance_due": str(sale.balance_due)},
        )
        if sale.balance_due == 0 and sale.receivable:
            from apps.api.modules.notifications.alert_service import MerchantAlertService

            await MerchantAlertService(self.db).resolve(
                business_id, f"credit_overdue:{sale.receivable.id}"
            )
        return sale

    async def create_credit_repayment_intent(
        self, business_id: UUID, sale_id: UUID, amount: Decimal, idempotency_key: str
    ) -> PaymentIntentResponse:
        from apps.api.modules.invoicing.models import Invoice
        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.paystack import PaystackClient

        sale = await self._get_sale(business_id, sale_id)
        if sale.payment_method != "credit" or sale.balance_due <= 0:
            raise SMEFlowError("This sale has no outstanding credit balance.", "NO_BALANCE_DUE", 400)
        if amount > sale.balance_due:
            raise SMEFlowError(
                "Repayment amount cannot exceed the outstanding balance.",
                "REPAYMENT_EXCEEDS_BALANCE",
                422,
                details={"balance_due": str(sale.balance_due)},
            )
        cache_key = f"credit-repayment:{business_id}:{idempotency_key}"
        cached = await idempotency_store.get(business_id, cache_key)
        if cached:
            return PaymentIntentResponse(**cached)

        invoice = await self.db.scalar(select(Invoice).where(Invoice.sale_id == sale.id))
        if not invoice:
            raise SMEFlowError("The credit invoice is still being generated. Retry shortly.", "INVOICE_PENDING", 409)

        reference = f"credit-repayment-{uuid4()}"
        payment = Payment(
            business_id=business_id,
            invoice_id=invoice.id,
            sale_id=sale.id,
            type="collection",
            provider="paystack",
            processor="paystack",
            amount=amount,
            internal_ref=reference,
            external_ref=reference,
            status="pending",
            idempotency_key=cache_key,
            metadata_={"intent_type": "credit_repayment", "payment_url": None},
        )
        self.db.add(payment)
        await self.db.flush([payment])
        try:
            initialized = await PaystackClient().initialize_transaction(
                PaystackClient.transaction_email(reference),
                amount,
                reference,
                metadata={
                    "intent_type": "credit_repayment",
                    "payment_id": str(payment.id),
                    "sale_id": str(sale.id),
                    "invoice_id": str(invoice.id),
                    "business_id": str(business_id),
                },
            )
            payment_url = initialized.get("authorization_url")
            if not payment_url:
                raise PaymentError("Paystack did not return a repayment URL. Please retry.", "paystack")
        except Exception as exc:
            payment.status = "failed"
            payment.provider_message = self._paystack_error_message(exc)
            await self.db.flush([payment])
            if isinstance(exc, PaymentError):
                raise
            raise PaymentError(payment.provider_message, "paystack") from exc

        payment.external_ref = initialized.get("reference") or reference
        payment.metadata_ = {**payment.metadata_, "payment_url": payment_url}
        await self.db.flush([payment])
        result = self._paystack_intent_response(payment)
        await idempotency_store.set(business_id, cache_key, result.model_dump(mode="json"))
        return result

    async def verify_credit_repayment_intent(
        self, business_id: UUID, sale_id: UUID, payment_id: UUID
    ) -> PaymentIntentResponse:
        from apps.api.modules.payments.models import Payment
        from apps.api.workers.tasks.payment_tasks import reconcile_confirmed_payment
        from libs.payment_clients.paystack import PaystackClient

        payment = await self.db.scalar(
            select(Payment).where(
                Payment.id == payment_id,
                Payment.business_id == business_id,
                Payment.sale_id == sale_id,
            )
        )
        if not payment or (payment.metadata_ or {}).get("intent_type") != "credit_repayment":
            raise NotFoundError("Credit repayment", str(payment_id))
        if payment.status != "success" and payment.external_ref:
            details = await PaystackClient().verify_transaction_details(payment.external_ref)
            payment.status = details["status"]
            payment.channel = details.get("channel")
            payment.provider_detail = details.get("provider_detail")
            if payment.status == "success":
                payment.confirmed_at = datetime.now(timezone.utc)
                await self.db.flush([payment])
                await reconcile_confirmed_payment(self.db, str(payment.id))
        await self.db.flush()
        return self._paystack_intent_response(payment)

    async def get_period_summary(self, business_id: UUID, from_date: str, to_date: str) -> dict:
        """Aggregate sales over a date range with payment method breakdown."""
        from datetime import date as date_type
        from datetime import datetime, time, timedelta

        start = date_type.fromisoformat(from_date)
        end = date_type.fromisoformat(to_date)
        start_at = datetime.combine(start, time.min)
        end_at = datetime.combine(end + timedelta(days=1), time.min)
        result = await self.db.execute(
            select(
                func.count(Sale.id).label("total_sales"),
                func.sum(Sale.total).label("total_revenue"),
                func.sum(
                    case((Sale.payment_method == "cash", Sale.total), else_=Decimal("0"))
                ).label("cash_revenue"),
                func.sum(
                    case((Sale.payment_method.in_(["momo", "ghqr", "paystack"]), Sale.total), else_=Decimal("0"))
                ).label("momo_revenue"),
                func.sum(
                    case((Sale.payment_method == "credit", Sale.total), else_=Decimal("0"))
                ).label("credit_revenue"),
                func.sum(Sale.balance_due).label("outstanding_credit"),
            ).where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
        )
        row = result.one()
        return {
            "from_date": from_date,
            "to_date": to_date,
            "total_sales": row.total_sales or 0,
            "total_revenue": row.total_revenue or Decimal("0"),
            "cash_revenue": row.cash_revenue or Decimal("0"),
            "momo_revenue": row.momo_revenue or Decimal("0"),
            "credit_revenue": row.credit_revenue or Decimal("0"),
            "outstanding_credit": row.outstanding_credit or Decimal("0"),
        }

    async def get_daily_summary(self, business_id: UUID, date_str: str) -> dict:
        from datetime import date as date_type
        from datetime import datetime, time, timedelta

        target = date_type.fromisoformat(date_str)
        start_at = datetime.combine(target, time.min)
        end_at = datetime.combine(target + timedelta(days=1), time.min)
        result = await self.db.execute(
            select(
                func.count(Sale.id).label("total_sales"),
                func.sum(Sale.total).label("total_revenue"),
                func.sum(
                    case((Sale.payment_method == "cash", Sale.total), else_=Decimal("0"))
                ).label("cash_revenue"),
                func.sum(
                    case((Sale.payment_method.in_(["momo", "ghqr", "paystack"]), Sale.total), else_=Decimal("0"))
                ).label("momo_revenue"),
                func.sum(
                    case((Sale.payment_method == "credit", Sale.total), else_=Decimal("0"))
                ).label("credit_revenue"),
            ).where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
        )
        row = result.one()

        # Get top items
        top_items_result = await self.db.execute(
            select(
                SaleItem.description,
                func.sum(SaleItem.qty).label("total_qty"),
                func.sum(SaleItem.line_total).label("total_revenue"),
            )
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
            .group_by(SaleItem.description)
            .order_by(func.sum(SaleItem.line_total).desc())
            .limit(5)
        )
        top_items = [
            {
                "description": r.description,
                "total_qty": r.total_qty or Decimal("0"),
                "total_revenue": r.total_revenue or Decimal("0"),
            }
            for r in top_items_result.all()
        ]

        return {
            "date": date_str,
            "total_sales": row.total_sales or 0,
            "total_revenue": row.total_revenue or Decimal("0"),
            "cash_revenue": row.cash_revenue or Decimal("0"),
            "momo_revenue": row.momo_revenue or Decimal("0"),
            "credit_revenue": row.credit_revenue or Decimal("0"),
            "top_items": top_items,
        }

    # ── Private helpers ────────────────────────────────────────────────────────
    async def _reserve_stock_for_intent(
        self,
        business_id: UUID,
        payment_id: UUID,
        item_lines: list[dict],
        expires_at: datetime,
    ) -> None:
        from apps.api.core.exceptions import InsufficientStockError
        from apps.api.modules.inventory.models import Item, StockReservation

        for line in item_lines:
            item_id = line.get("item_id")
            if not item_id:
                continue
            item_result = await self.db.execute(
                select(Item).where(Item.id == item_id, Item.business_id == business_id)
            )
            item = item_result.scalar_one_or_none()
            if not item:
                raise NotFoundError("Item", str(item_id))
            reserved = await self.db.scalar(
                select(func.coalesce(func.sum(StockReservation.qty), 0)).where(
                    StockReservation.business_id == business_id,
                    StockReservation.item_id == item_id,
                    StockReservation.status == "active",
                    StockReservation.expires_at > datetime.now(timezone.utc),
                )
            )
            available = item.current_stock - Decimal(str(reserved or 0))
            if available < line["qty"]:
                raise InsufficientStockError(item.name, float(available), float(line["qty"]))
            self.db.add(
                StockReservation(
                    business_id=business_id,
                    payment_id=payment_id,
                    item_id=item_id,
                    qty=line["qty"],
                    status="active",
                    expires_at=expires_at,
                )
            )
        await self.db.flush()

    async def _release_reservations(self, payment_id: UUID) -> None:
        from apps.api.modules.inventory.models import StockReservation

        rows = (
            (
                await self.db.execute(
                    select(StockReservation).where(
                        StockReservation.payment_id == payment_id,
                        StockReservation.status == "active",
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            row.status = "released"
        if rows:
            await self.db.flush(rows)

    async def _complete_reservations(self, payment_id: UUID) -> None:
        from apps.api.modules.inventory.models import StockReservation

        rows = (
            (
                await self.db.execute(
                    select(StockReservation).where(
                        StockReservation.payment_id == payment_id,
                        StockReservation.status == "active",
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            row.status = "completed"
        if rows:
            await self.db.flush(rows)

    async def release_expired_stock_reservations(self) -> int:
        from apps.api.modules.inventory.models import StockReservation

        rows = (
            (
                await self.db.execute(
                    select(StockReservation).where(
                        StockReservation.status == "active",
                        StockReservation.expires_at <= datetime.now(timezone.utc),
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            row.status = "released"
        if rows:
            await self.db.flush(rows)
        return len(rows)

    async def _get_momo_intent_payment(self, business_id: UUID, payment_id: UUID):
        return await self._get_payment_intent(business_id, payment_id, "sale_momo")

    async def _get_payment_intent(self, business_id: UUID, payment_id: UUID, intent_type: str):
        from apps.api.modules.payments.models import Payment

        result = await self.db.execute(
            select(Payment).where(Payment.id == payment_id, Payment.business_id == business_id)
        )
        payment = result.scalar_one_or_none()
        if not payment:
            raise NotFoundError("Payment", str(payment_id))
        if (payment.metadata_ or {}).get("intent_type") != intent_type:
            raise NotFoundError("Sale payment intent", str(payment_id))
        return payment

    @staticmethod
    def _intent_expires_at(payment: object) -> datetime | None:
        raw = (getattr(payment, "metadata_", None) or {}).get("expires_at")
        if not raw:
            return None
        parsed = datetime.fromisoformat(str(raw))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    async def _resolve_items(self, business_id: UUID, items: list) -> list[dict]:
        """Look up item names/prices from DB for item_id entries; use inline for ad-hoc."""
        from sqlalchemy import select

        from apps.api.modules.inventory.models import Item

        lines = []
        for inp in items:
            cost_price: Decimal | None = None
            if inp.item_id:
                result = await self.db.execute(
                    select(Item).where(Item.id == inp.item_id, Item.business_id == business_id)
                )
                item = result.scalar_one_or_none()
                if not item:
                    raise NotFoundError("Item", str(inp.item_id))
                description = item.name
                # Snapshot cost_price at the moment of sale for COGS tracking
                cost_price = getattr(item, "cost_price", None)
            else:
                description = inp.description or "Item"

            line_total = (inp.qty * inp.unit_price) - inp.discount
            lines.append(
                {
                    "item_id": inp.item_id,
                    "description": description,
                    "qty": inp.qty,
                    "unit_price": inp.unit_price,
                    "discount": inp.discount,
                    "line_total": max(line_total, Decimal("0")),
                    "cost_price": cost_price,
                }
            )
        return lines

    async def _upsert_customer(
        self,
        business_id: UUID,
        phone: str | None,
        name: str | None,
        *,
        reminder_consent: bool = False,
        reminder_channel: str | None = None,
    ) -> UUID:
        """
        Get-or-create a Customer by (business_id, phone).

        When phone is provided, uses INSERT ... ON CONFLICT (business_id, phone)
        WHERE phone IS NOT NULL DO UPDATE to atomically upsert — eliminating the
        classic SELECT-then-INSERT race that created duplicate Customer rows.

        When phone is None (anonymous walk-in), a new row is always inserted.
        """
        if phone:
            from apps.api.core.phone import normalize_ghana_phone

            phone = normalize_ghana_phone(phone)
            existing_id = (
                await self.db.execute(
                    select(Customer.id).where(
                        Customer.business_id == business_id,
                        Customer.phone == phone,
                    )
                )
            ).scalar_one_or_none()
            if existing_id:
                return existing_id
            await self._check_customer_limit(business_id)
            insert_stmt = pg_insert(Customer).values(
                business_id=business_id,
                phone=phone,
                name=name,
                reminder_consent=reminder_consent,
                reminder_channel=reminder_channel if reminder_consent else None,
                reminder_consent_at=datetime.now(timezone.utc) if reminder_consent else None,
                reminder_consent_source="credit_terms" if reminder_consent else None,
            )
            upsert_stmt = insert_stmt.on_conflict_do_update(
                index_elements=["business_id", "phone"],
                index_where=text("phone IS NOT NULL"),
                # Keep existing name if already set; fill it in if it was blank.
                set_={
                    "name": text("COALESCE(customers.name, EXCLUDED.name)"),
                    "reminder_consent": reminder_consent,
                    "reminder_channel": reminder_channel if reminder_consent else None,
                    "reminder_consent_at": (
                        datetime.now(timezone.utc) if reminder_consent else None
                    ),
                    "reminder_consent_source": "credit_terms" if reminder_consent else None,
                    "reminder_opt_out_at": None if reminder_consent else Customer.reminder_opt_out_at,
                },
            ).returning(Customer.id)
            upsert_result = await self.db.execute(upsert_stmt)
            return upsert_result.scalar_one()

        # Anonymous customer (no phone) — always create a fresh row.
        await self._check_customer_limit(business_id)
        customer = Customer(business_id=business_id, phone=None, name=name)
        self.db.add(customer)
        await self.db.flush([customer])
        return customer.id

    async def _check_customer_limit(self, business_id: UUID) -> None:
        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        billing = BillingService(self.db)
        customer_count = (
            await self.db.execute(
                select(func.count(Customer.id)).where(Customer.business_id == business_id)
            )
        ).scalar_one()
        if not await billing.check_limit(business_id, "customers", customer_count or 0):
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("customers", 0)
            raise LimitExceededError("customer records", limit)

    async def _create_momo_payment(
        self,
        business_id: UUID,
        sale_id: UUID,
        amount: Decimal,
        phone: str,
        idempotency_key: str,
        provider: str = "mtn",
    ) -> UUID:
        """Create the pending collection record that downstream polling/webhooks reconcile."""
        from apps.api.modules.payments.models import Payment

        provider_name = provider or "mtn"

        existing = await self.db.execute(
            select(Payment).where(
                Payment.business_id == business_id,
                Payment.sale_id == sale_id,
                Payment.type == "collection",
                Payment.provider == provider_name,
            )
        )
        payment = existing.scalar_one_or_none()
        if payment:
            return payment.id

        payment = Payment(
            business_id=business_id,
            sale_id=sale_id,
            type="collection",
            provider=provider_name,
            amount=amount,
            phone=phone,
            internal_ref=f"sale-{sale_id}",
            status="pending",
            provider_message="Paystack MoMo request pending provider dispatch",
            idempotency_key=idempotency_key,
        )
        self.db.add(payment)
        await self.db.flush([payment])

        try:
            from apps.api.workers.tasks.payment_tasks import initiate_pending_payment

            enqueue_task(initiate_pending_payment, str(payment.id))
        except Exception as exc:
            logger.warning(
                "sale.momo_payment_task_failed", payment_id=str(payment.id), error=str(exc)
            )

        return payment.id

    async def retry_momo_payment(self, business_id: UUID, sale_id: UUID) -> dict:
        """
        Re-trigger the MoMo RequestToPay for a sale whose payment is pending or failed.
        Only applies to momo-method sales; raises ConflictError for other states.
        """
        from apps.api.modules.payments.models import Payment
        from apps.api.workers.tasks.payment_tasks import initiate_pending_payment

        sale = await self._get_sale(business_id, sale_id)

        if sale.status not in ("pending_payment", "failed"):
            raise ConflictError(
                f"Cannot retry payment for a sale with status '{sale.status}'. "
                "Only pending_payment or failed sales can be retried."
            )
        if sale.payment_method != "momo":
            raise ConflictError("Retry is only available for MoMo payment sales.")

        # Find the most recent collection payment for this sale
        payment_result = await self.db.execute(
            select(Payment)
            .where(
                Payment.sale_id == sale_id,
                Payment.type == "collection",
            )
            .order_by(Payment.created_at.desc())
        )
        payment = payment_result.scalar_one_or_none()

        if not payment:
            raise ConflictError(
                "No payment record found for this sale. "
                "The original MoMo request may not have been initiated yet."
            )

        # Reset to pending and re-queue
        payment.status = "pending"
        payment.provider_message = "MoMo retry requested by merchant"
        await self.db.flush([payment])

        try:
            enqueue_task(initiate_pending_payment, str(payment.id))
        except Exception as exc:
            logger.warning(
                "sale.retry_payment_task_failed", payment_id=str(payment.id), error=str(exc)
            )

        logger.info(
            "sale.momo_payment_retried",
            business_id=str(business_id),
            sale_id=str(sale_id),
            payment_id=str(payment.id),
        )
        return {
            "sale_id": str(sale_id),
            "payment_id": str(payment.id),
            "status": "pending",
            "message": "MoMo payment request re-sent. The customer will receive a new prompt.",
        }

    async def _get_sale(self, business_id: UUID, sale_id: UUID) -> Sale:
        result = await self.db.execute(
            select(Sale)
            .where(Sale.id == sale_id)
            .options(selectinload(Sale.items), selectinload(Sale.receivable))
        )
        sale = result.scalar_one_or_none()
        if not sale:
            raise NotFoundError("Sale", str(sale_id))
        if sale.business_id != business_id:
            raise TenantMismatchError()
        return sale

    async def _trigger_async_tasks(self, sale: Sale, business_id: UUID) -> UUID | None:
        """Create the sale receipt/invoice row and queue heavy invoice assets."""
        try:
            from apps.api.modules.invoicing.service import InvoicingService

            invoice = await InvoicingService(self.db).generate_from_sale(sale.id, business_id)
            return invoice.id
        except Exception as e:
            logger.warning("sale.invoice_generation_failed", sale_id=str(sale.id), error=str(e))
            return None

    def _queue_sale_notification(self, business_id: UUID, sale: Sale) -> None:
        try:
            from apps.api.workers.tasks.notification_tasks import send_notification

            enqueue_task(
                send_notification,
                str(business_id),
                "sale.recorded",
                {"total": str(sale.total)},
            )
        except Exception as exc:
            logger.warning("sale.notification_failed", sale_id=str(sale.id), error=str(exc))

    def _queue_credit_score_recalculation(self, business_id: UUID) -> None:
        try:
            from apps.api.workers.tasks.credit_tasks import compute_credit_score

            enqueue_task(compute_credit_score, str(business_id))
        except Exception as exc:
            logger.warning(
                "sale.credit_recalc_failed", business_id=str(business_id), error=str(exc)
            )

    async def _record_metrics(self, business_id: UUID, sale: Sale) -> None:
        try:
            business = (
                await self.db.execute(select(Business).where(Business.id == business_id))
            ).scalar_one_or_none()
            record_sale_metric(
                sale.payment_method,
                business.subscription if business else "unknown",
                float(sale.total),
            )
        except Exception as exc:
            logger.warning("sale.metric_failed", sale_id=str(sale.id), error=str(exc))
