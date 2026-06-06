"""Payments endpoints + MoMo webhook handlers."""

import json
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_business_id, get_current_user_id
from apps.api.core.exceptions import NotFoundError, PaymentCapabilityError, PaymentError
from apps.api.core.idempotency import idempotency_store
from apps.api.core.phone import normalize_ghana_phone
from apps.api.modules.business.models import MoMoAccount
from apps.api.modules.payments.models import Payment

logger = structlog.get_logger()
settings = get_settings()
router = APIRouter()


class PaymentRequest(BaseModel):
    amount: Decimal = Field(..., gt=0, le=Decimal("50000.00"))
    provider: str  # mtn, vodafone, airteltigo
    phone: str
    reference: str | None = None
    invoice_id: UUID | None = None
    sale_id: UUID | None = None
    idempotency_key: str

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return normalize_ghana_phone(v)


class PaymentResponse(BaseModel):
    payment_id: UUID
    external_ref: str | None
    status: str
    message: str = "Payment request initiated"

    model_config = {"from_attributes": True}


class DisbursementRequest(BaseModel):
    amount: Decimal = Field(..., gt=0, le=Decimal("50000.00"))
    phone: str
    reference: str | None = None
    description: str = "SMEFlow disbursement"
    idempotency_key: str

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return normalize_ghana_phone(v)


class GhQRRequest(BaseModel):
    amount: Decimal | None = None  # None = static QR
    invoice_id: UUID | None = None


class PaymentDetail(BaseModel):
    id: UUID
    business_id: UUID
    invoice_id: UUID | None
    sale_id: UUID | None
    type: str
    provider: str
    processor: str | None
    channel: str | None
    provider_detail: str | None
    amount: Decimal
    currency: str
    phone: str | None
    external_ref: str | None
    internal_ref: str | None
    status: str
    provider_message: str | None
    idempotency_key: str | None
    initiated_at: str
    confirmed_at: str | None
    created_at: str

    model_config = {"from_attributes": True}


def _reconciliation_state(payment: Payment) -> str:
    if payment.status == "reversed":
        return "refunded"
    if (payment.metadata_ or {}).get("reconciliation_ignored"):
        return "ignored"
    if payment.invoice_id or payment.sale_id:
        return "matched"
    return "unmatched"


@router.get("/reconciliation/inbox", response_model=dict)
async def get_reconciliation_inbox(
    provider: str | None = None,
    include_ignored: bool = False,
    limit: int = 50,
    offset: int = 0,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return successful MoMo/card collections needing owner reconciliation.

    By default, already-ignored payments are excluded. Pass include_ignored=true
    to see the full history including intentionally skipped items.
    """
    from sqlalchemy import func as sqlfunc

    query = select(Payment).where(
        Payment.business_id == business_id,
        Payment.type == "collection",
        Payment.status.in_(["success", "reversed"]),
    )
    if provider:
        query = query.where(Payment.provider == provider)

    payments = (
        (await db.execute(query.order_by(Payment.created_at.desc())))
        .scalars()
        .all()
    )

    summary = {
        "unmatched": 0,
        "suggested_match": 0,
        "matched": 0,
        "ignored": 0,
        "refunded": 0,
    }
    all_items = []
    for payment in payments:
        match_state = _reconciliation_state(payment)
        summary[match_state] += 1
        all_items.append(
            {
                "id": str(payment.id),
                "provider": payment.provider,
                "amount": payment.amount,
                "currency": payment.currency,
                "phone": payment.phone,
                "external_ref": payment.external_ref,
                "invoice_id": str(payment.invoice_id) if payment.invoice_id else None,
                "sale_id": str(payment.sale_id) if payment.sale_id else None,
                "status": payment.status,
                "match_state": match_state,
                "suggested_match_type": "sale"
                if payment.sale_id
                else "invoice"
                if payment.invoice_id
                else None,
                "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
                "created_at": payment.created_at.isoformat(),
            }
        )

    # Filter out ignored unless caller explicitly wants them
    visible = [i for i in all_items if include_ignored or i["match_state"] != "ignored"]
    total = len(visible)
    items = visible[offset : offset + limit]

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "summary": summary,
        "items": items,
    }


@router.post("/reconciliation/{payment_id}/ignore", response_model=dict)
async def ignore_reconciliation_item(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark a collected payment as intentionally not linked to a sale or invoice.

    This removes it from the unmatched queue without requiring a formal link.
    The payment record and funds are unaffected — this is a display-only flag.
    """
    result = await db.execute(
        select(Payment).where(
            Payment.id == payment_id,
            Payment.business_id == business_id,
            Payment.type == "collection",
        )
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")

    metadata = dict(payment.metadata_ or {})
    metadata["reconciliation_ignored"] = True
    payment.metadata_ = metadata
    await db.flush([payment])

    logger.info("reconciliation.ignored", payment_id=str(payment_id), business_id=str(business_id))
    return {"payment_id": str(payment_id), "match_state": "ignored", "message": "Payment marked as ignored."}


@router.post("/reconciliation/{payment_id}/unignore", response_model=dict)
async def unignore_reconciliation_item(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Restore an ignored payment back to the unmatched queue."""
    result = await db.execute(
        select(Payment).where(
            Payment.id == payment_id,
            Payment.business_id == business_id,
            Payment.type == "collection",
        )
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")

    metadata = dict(payment.metadata_ or {})
    metadata.pop("reconciliation_ignored", None)
    payment.metadata_ = metadata
    await db.flush([payment])

    return {"payment_id": str(payment_id), "match_state": "unmatched", "message": "Payment restored to queue."}


@router.get("", response_model=dict)
async def list_payments(
    status: str | None = None,
    provider: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 50,
    offset: int = 0,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List payment records for the business with optional filters."""
    from sqlalchemy import func as sqlfunc

    query = select(Payment).where(Payment.business_id == business_id)
    count_q = select(sqlfunc.count(Payment.id)).where(Payment.business_id == business_id)

    if status:
        query = query.where(Payment.status == status)
        count_q = count_q.where(Payment.status == status)
    if provider:
        query = query.where(Payment.provider == provider)
        count_q = count_q.where(Payment.provider == provider)
    if from_date:
        from datetime import date as date_type
        from datetime import datetime, time

        start_at = datetime.combine(date_type.fromisoformat(from_date), time.min)
        query = query.where(Payment.created_at >= start_at)
        count_q = count_q.where(Payment.created_at >= start_at)
    if to_date:
        from datetime import date as date_type
        from datetime import datetime, time, timedelta

        end_at = datetime.combine(date_type.fromisoformat(to_date) + timedelta(days=1), time.min)
        query = query.where(Payment.created_at < end_at)
        count_q = count_q.where(Payment.created_at < end_at)

    total = (await db.execute(count_q)).scalar_one()
    rows = (
        (await db.execute(query.order_by(Payment.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(p.id),
                "type": p.type,
                "provider": p.provider,
                "processor": p.processor,
                "channel": p.channel,
                "provider_detail": p.provider_detail,
                "amount": p.amount,
                "currency": p.currency,
                "phone": p.phone,
                "status": p.status,
                "external_ref": p.external_ref,
                "invoice_id": str(p.invoice_id) if p.invoice_id else None,
                "sale_id": str(p.sale_id) if p.sale_id else None,
                "confirmed_at": p.confirmed_at.isoformat() if p.confirmed_at else None,
                "created_at": p.created_at.isoformat(),
            }
            for p in rows
        ],
    }


@router.get("/analytics/channels", response_model=dict)
async def get_payment_channel_analytics(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Platform-held credited collections grouped by processor and payment channel."""
    from sqlalchemy import func as sqlfunc
    from apps.api.modules.settlements.models import MerchantLedgerEntry

    momo_providers = ("mtn", "vodafone", "airteltigo")
    processor = sqlfunc.coalesce(Payment.processor, "paystack").label("processor")
    channel = case(
        (Payment.channel.is_(None) & Payment.provider.in_(momo_providers), "mobile_money"),
        else_=sqlfunc.coalesce(Payment.channel, "online"),
    ).label("channel")
    provider_detail = case(
        (
            Payment.provider_detail.is_(None) & Payment.provider.in_(momo_providers),
            Payment.provider,
        ),
        else_=Payment.provider_detail,
    ).label("provider_detail")

    rows = (
        await db.execute(
            select(
                processor,
                channel,
                provider_detail,
                sqlfunc.count(MerchantLedgerEntry.id).label("count"),
                sqlfunc.coalesce(sqlfunc.sum(MerchantLedgerEntry.amount), 0).label("total"),
            )
            .select_from(MerchantLedgerEntry)
            .join(Payment, Payment.id == MerchantLedgerEntry.payment_id)
            .where(
                MerchantLedgerEntry.business_id == business_id,
                MerchantLedgerEntry.type == "credit",
                Payment.type == "collection",
                Payment.status == "success",
                Payment.provider != "cash",
                sqlfunc.coalesce(Payment.processor, "paystack") != "manual",
            )
            .group_by(processor, channel, provider_detail)
            .order_by(sqlfunc.sum(MerchantLedgerEntry.amount).desc())
        )
    ).all()
    return {
        "grand_total": sum((row.total for row in rows), Decimal("0")),
        "items": [
            {
                "processor": row.processor,
                "channel": row.channel,
                "provider_detail": row.provider_detail,
                "count": row.count,
                "total": row.total,
            }
            for row in rows
        ],
    }


@router.get("/{payment_id}", response_model=dict)
async def get_payment(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Fetch a single payment record by ID."""
    result = await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.business_id == business_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")

    return {
        "id": str(payment.id),
        "business_id": str(payment.business_id),
        "invoice_id": str(payment.invoice_id) if payment.invoice_id else None,
        "sale_id": str(payment.sale_id) if payment.sale_id else None,
        "type": payment.type,
        "provider": payment.provider,
        "processor": payment.processor,
        "channel": payment.channel,
        "provider_detail": payment.provider_detail,
        "amount": payment.amount,
        "currency": payment.currency,
        "phone": payment.phone,
        "external_ref": payment.external_ref,
        "internal_ref": payment.internal_ref,
        "status": payment.status,
        "provider_status": payment.provider_status,
        "provider_message": payment.provider_message,
        "idempotency_key": payment.idempotency_key,
        "initiated_at": payment.initiated_at.isoformat(),
        "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
        "created_at": payment.created_at.isoformat(),
        "updated_at": payment.updated_at.isoformat(),
    }


@router.post("/request", response_model=PaymentResponse, status_code=201)
async def request_payment(
    body: PaymentRequest,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentResponse:
    """Initiate a MoMo collection (RequestToPay)."""
    # Idempotency
    cached = await idempotency_store.get(business_id, body.idempotency_key)
    if cached:
        return PaymentResponse(**cached)

    reference = body.reference or str(uuid4())

    # Create pending payment record
    payment = Payment(
        business_id=business_id,
        invoice_id=body.invoice_id,
        sale_id=body.sale_id,
        type="collection",
        provider=body.provider,
        processor="paystack",
        amount=body.amount,
        phone=body.phone,
        internal_ref=reference,
        status="pending",
        idempotency_key=body.idempotency_key,
    )
    db.add(payment)
    await db.flush([payment])

    # Call provider
    try:
        from libs.payment_clients.paystack import PaystackClient

        client = PaystackClient(body.provider)
        resp = await client.request_payment(body.amount, body.phone, reference, "SMEFlow payment")
        payment.external_ref = resp.external_ref
        payment.status = resp.status
        payment.provider_message = resp.provider_message
        await db.flush([payment])
    except PaymentCapabilityError:
        payment.status = "failed"
        payment.provider_message = f"{body.provider} does not currently support collections"
        await db.flush([payment])
        raise
    except Exception as e:
        payment.status = "failed"
        payment.provider_message = str(e)
        await db.flush([payment])
        raise PaymentError(str(e), provider=body.provider) from e

    result = PaymentResponse(
        payment_id=payment.id,
        external_ref=payment.external_ref,
        status=payment.status,
    )
    await idempotency_store.set(business_id, body.idempotency_key, result.model_dump(mode="json"))
    return result


@router.post("/disburse", response_model=PaymentResponse, status_code=201)
async def disburse_payment(
    body: DisbursementRequest,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentResponse:
    """Initiate a mobile-money disbursement from the business primary verified wallet."""
    _ = user_id
    cached = await idempotency_store.get(business_id, body.idempotency_key)
    if cached:
        return PaymentResponse(**cached)

    account_result = await db.execute(
        select(MoMoAccount).where(
            MoMoAccount.business_id == business_id,
            MoMoAccount.is_primary.is_(True),
            MoMoAccount.is_verified.is_(True),
            MoMoAccount.status == "verified",
        )
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise NotFoundError("Verified primary wallet")

    reference = body.reference or str(uuid4())
    payment = Payment(
        business_id=business_id,
        type="disbursement",
        provider=account.provider,
        amount=body.amount,
        phone=body.phone,
        internal_ref=reference,
        status="pending",
        idempotency_key=body.idempotency_key,
    )
    db.add(payment)
    await db.flush([payment])

    try:
        from libs.payment_clients.providers import get_payment_provider

        client = get_payment_provider(account.provider)
        resp = await client.disburse(body.amount, body.phone, reference, body.description)
        payment.external_ref = resp.external_ref
        payment.status = resp.status
        payment.provider_message = resp.provider_message
        await db.flush([payment])
    except PaymentCapabilityError:
        payment.status = "failed"
        payment.provider_message = f"{account.provider} does not currently support disbursements"
        await db.flush([payment])
        raise
    except Exception as e:
        payment.status = "failed"
        payment.provider_message = str(e)
        await db.flush([payment])
        raise PaymentError(str(e), provider=account.provider) from e

    result = PaymentResponse(
        payment_id=payment.id,
        external_ref=payment.external_ref,
        status=payment.status,
        message="Disbursement request initiated",
    )
    await idempotency_store.set(business_id, body.idempotency_key, result.model_dump(mode="json"))
    return result


@router.post("/ghqr/generate", status_code=201)
async def generate_ghqr(
    body: GhQRRequest,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generate a GhQR code (static or dynamic)."""
    from apps.api.modules.business.models import Business
    from libs.qr_generator.ghqr import generate_ghqr_payload

    biz_result = await db.execute(select(Business).where(Business.id == business_id))
    business = biz_result.scalar_one_or_none()
    if not business:
        raise HTTPException(404, "Business not found")

    payload = generate_ghqr_payload(business, body.amount)
    return {"qr_payload": payload, "amount": body.amount, "currency": "GHS"}


# ── Webhooks ──────────────────────────────────────────────────────────────────


# ── Paystack webhook — unified endpoint for all Paystack events ───────────────
@router.post("/webhooks/paystack", include_in_schema=False)
async def paystack_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Unified Paystack event callback.

    Handles: charge.success, transfer.success/failed/reversed,
             subscription.create/disable/not_renew, invoice.payment_failed,
             dedicatedaccount.assign.success

    Paystack signs every event with:
      X-Paystack-Signature: hex(HMAC-SHA512(secret_key, raw_body))
    """
    from apps.api.core.webhook_security import require_webhook_ip

    require_webhook_ip(request, "paystack", settings.WEBHOOK_ALLOWED_IPS_PAYSTACK)
    raw_body = await request.body()
    sig = request.headers.get("X-Paystack-Signature", "")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Invalid JSON") from exc

    from libs.payment_clients.paystack import PaystackClient

    client = PaystackClient()
    if not client.verify_webhook_raw(raw_body, sig):
        logger.warning("paystack.webhook.invalid_signature")
        return {"status": "ignored"}

    event = payload.get("event", "")

    _PAYMENT_EVENTS = {"charge.success", "transfer.success", "transfer.failed", "transfer.reversed"}
    _BILLING_EVENTS = {
        "subscription.create",
        "subscription.disable",
        "subscription.not_renew",
        "invoice.payment_failed",
    }

    data = payload.get("data", {})

    if await _is_duplicate_unified_paystack(event, data, payload):
        return {"status": "duplicate"}

    if event in _PAYMENT_EVENTS:
        await _apply_paystack_payment_update(payload, db, background_tasks)
        from apps.api.modules.payments.paystack_handlers import dispatch_paystack_side_effects

        await dispatch_paystack_side_effects(db, event, data)
    elif event in _BILLING_EVENTS:
        await _apply_paystack_billing_update(payload, db)
    elif event == "dedicatedaccount.assign.success":
        await _apply_dva_assigned(payload, db)
    else:
        logger.debug("paystack.webhook.unhandled_event", event=event)

    return {"status": "received"}


async def _is_duplicate_unified_paystack(event: str, data: dict, payload: dict) -> bool:
    from apps.api.modules.payments.paystack_handlers import is_duplicate_paystack_event

    return await is_duplicate_paystack_event(event, data, payload)


# Keep old path alive during deprecation window for any in-flight Paystack events
@router.post("/webhooks/momo/paystack", include_in_schema=False)
async def paystack_webhook_legacy(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Legacy Paystack webhook path — delegates to the unified handler."""
    return await paystack_webhook(request, background_tasks, db)


async def _apply_paystack_payment_update(
    payload: dict,
    db: AsyncSession,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Apply Paystack event to the DB synchronously."""
    from datetime import datetime, timezone

    from apps.api.core.webhook_security import mark_webhook_seen

    event = payload.get("event", "")
    data = payload.get("data", {})
    reference = data.get("reference") or data.get("transfer_code", "")

    # Payment-row dedup (narrower than unified handler — avoids skipping ledger side effects)
    if await mark_webhook_seen("paystack_payment", reference):
        logger.info("paystack.webhook.duplicate", reference=reference)
        return

    event_status_map = {
        "charge.success": "success",
        "transfer.success": "success",
        "transfer.failed": "failed",
        "transfer.reversed": "reversed",
    }
    new_status = event_status_map.get(event, "pending")

    result = await db.execute(select(Payment).where(Payment.external_ref == reference))
    payment = result.scalar_one_or_none()
    if not payment:
        result = await db.execute(select(Payment).where(Payment.internal_ref == reference))
        payment = result.scalar_one_or_none()

    if not payment:
        if new_status == "success":
            from apps.api.modules.billing.service import BillingService

            if await BillingService(db).handle_webhook_success(reference):
                logger.info("paystack.webhook.billing_processed", reference=reference)
                return
        logger.warning("paystack.webhook.payment_not_found", reference=reference)
        return

    authorization = data.get("authorization") or {}
    payment.processor = "paystack"
    payment.channel = data.get("channel") or authorization.get("channel") or payment.channel
    payment.provider_detail = (
        authorization.get("brand")
        or authorization.get("bank")
        or authorization.get("provider")
        or payment.provider_detail
    )
    if payment.status == new_status:
        await db.flush([payment])
        return  # Already processed, but channel details may have arrived later.

    payment.status = new_status
    payment.provider_status = data.get("status", "")
    payment.provider_message = data.get("gateway_response") or data.get("reason", "")
    if new_status == "success":
        payment.confirmed_at = datetime.now(timezone.utc)

    await db.flush([payment])
    logger.info("paystack.webhook.processed", payment_id=str(payment.id), status=new_status)

    if new_status == "success":
        try:
            from apps.api.modules.billing.service import BillingService
            from apps.api.modules.sales.service import SalesService
            from apps.api.workers.dispatch import enqueue_task
            from apps.api.workers.tasks.payment_tasks import (
                notify_payment_confirmed,
                reconcile_confirmed_payment,
            )

            await BillingService(db).handle_webhook_success(reference)
            if (
                payment.sale_id is None
                and (payment.metadata_ or {}).get("intent_type") in {"sale_momo", "sale_paystack"}
            ):
                await SalesService(db).finalize_verified_payment_intent(
                    payment.id, payment.business_id
                )
                reconciled = True
            else:
                reconciled = await reconcile_confirmed_payment(db, str(payment.id))
            if reconciled and background_tasks is not None:
                # Notification is non-critical — safe to defer
                background_tasks.add_task(enqueue_task, notify_payment_confirmed, str(payment.id))
        except Exception as e:
            logger.error("paystack.webhook.downstream_failed", error=str(e))

        # Credit merchant settlement ledger for every confirmed collection
        if payment.type == "collection":
            try:
                from apps.api.modules.settlements.service import MerchantSettlementService
                await MerchantSettlementService(db).credit_collection(payment.id)
            except Exception as exc:
                # Never block the main webhook flow — settlement credit is best-effort here;
                # the daily reconciliation will catch any missed credits.
                logger.error(
                    "settlement.credit_collection.failed",
                    payment_id=str(payment.id),
                    error=str(exc),
                )


async def _apply_paystack_billing_update(payload: dict, db: AsyncSession) -> None:
    """Handle Paystack subscription lifecycle events."""
    from apps.api.modules.billing.service import BillingService

    event = payload.get("event", "")
    try:
        await BillingService(db).handle_paystack_webhook(payload)
        logger.info("paystack.webhook.billing_updated", event=event)
    except Exception as exc:
        logger.error("paystack.webhook.billing_update_failed", event=event, error=str(exc))


async def _apply_dva_assigned(payload: dict, db: AsyncSession) -> None:
    """Handle dedicatedaccount.assign.success — store DVA details on the Business."""
    from sqlalchemy import select as _select

    from apps.api.modules.business.models import Business

    data = payload.get("data", {})
    customer = data.get("customer", {})
    customer_code = customer.get("customer_code") or customer.get("id", "")
    account_number = data.get("account_number", "")
    account_name = data.get("account_name", "")
    bank_name = (data.get("bank") or {}).get("name", "")
    dva_id = str(data.get("id", ""))

    if not customer_code:
        logger.warning("paystack.webhook.dva_no_customer_code")
        return

    result = await db.execute(
        _select(Business).where(Business.paystack_customer_code == customer_code)
    )
    biz = result.scalar_one_or_none()
    if not biz:
        logger.warning("paystack.webhook.dva_business_not_found", customer_code=customer_code)
        return

    biz.dva_id = dva_id
    biz.dva_account_number = account_number
    biz.dva_account_name = account_name
    biz.dva_bank_name = bank_name
    await db.flush([biz])
    logger.info(
        "paystack.webhook.dva_assigned",
        business_id=str(biz.id),
        account_number=account_number,
    )
