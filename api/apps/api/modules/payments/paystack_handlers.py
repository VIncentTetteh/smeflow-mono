"""
Shared Paystack webhook handlers for transfers, settlements, loans, and agent payouts.

Invoked from the primary payments webhook and (legacy) payouts webhook so a single
Paystack dashboard URL is sufficient.
"""

from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.webhook_security import mark_webhook_seen

logger = structlog.get_logger()

_TRANSFER_EVENTS = frozenset({"transfer.success", "transfer.failed", "transfer.reversed"})


def paystack_event_dedup_key(event: str, data: dict, payload: dict) -> str:
    """Stable idempotency key shared across all Paystack webhook entry points."""
    event_id = (
        payload.get("idempotencyKey")
        or data.get("id")
        or data.get("transfer_code")
        or data.get("reference")
        or ""
    )
    return f"{event}:{event_id}"


async def is_duplicate_paystack_event(event: str, data: dict, payload: dict) -> bool:
    key = paystack_event_dedup_key(event, data, payload)
    if not key or key == f"{event}:":
        return False
    return await mark_webhook_seen("paystack", key)


async def dispatch_paystack_side_effects(
    db: AsyncSession,
    event: str,
    data: dict,
) -> None:
    """Run payout/settlement/loan/agent/DVA handlers alongside payment row updates."""
    if event in _TRANSFER_EVENTS:
        if event == "transfer.success":
            await handle_transfer_success(db, data)
        else:
            await handle_transfer_failure(db, data, reason=event)
        return

    if event == "charge.success":
        await handle_charge_success_payout_side(db, data)


async def handle_transfer_success(db: AsyncSession, data: dict) -> None:
    transfer_code = data.get("transfer_code") or data.get("id", "")
    reference = data.get("reference", "")

    from apps.api.modules.credit.service import CreditService

    loan = await CreditService(db).confirm_disbursement(transfer_code)
    if loan:
        logger.info(
            "paystack.transfer.disbursement_confirmed",
            loan_id=str(loan.id),
            transfer_code=transfer_code,
        )
        return

    if reference.startswith("settle-"):
        from apps.api.modules.settlements.service import MerchantSettlementService

        settlement = await MerchantSettlementService(db).confirm_settlement(
            transfer_code=transfer_code or None,
            reference=reference or None,
        )
        if settlement:
            logger.info(
                "paystack.transfer.settlement_confirmed",
                settlement_id=str(settlement.id),
                transfer_code=transfer_code,
            )
            return

    if reference.startswith("payout-"):
        await _mark_agent_transfer_paid(db, transfer_code, reference)
        return

    logger.debug(
        "paystack.transfer.success_unmatched",
        transfer_code=transfer_code,
        reference=reference,
    )


async def handle_transfer_failure(db: AsyncSession, data: dict, reason: str) -> None:
    transfer_code = data.get("transfer_code") or data.get("id", "")
    reference = data.get("reference", "")
    failure_reason = data.get("gateway_response") or reason

    from apps.api.modules.credit.service import CreditService
    from apps.api.workers.tasks.payout_tasks import retry_failed_disbursement

    loan = await CreditService(db).fail_disbursement(transfer_code, reason=failure_reason)
    if loan:
        retry_failed_disbursement.apply_async(args=[str(loan.id)], countdown=900)
        return

    if reference.startswith("settle-"):
        from apps.api.modules.settlements.service import MerchantSettlementService
        from apps.api.workers.tasks.payout_tasks import retry_failed_merchant_settlement

        settlement = await MerchantSettlementService(db).fail_settlement(
            transfer_code=transfer_code or None,
            reference=reference or None,
            reason=failure_reason,
        )
        if settlement:
            retry_failed_merchant_settlement.apply_async(
                args=[str(settlement.id)], countdown=1800
            )
            return

    if reference.startswith("payout-"):
        await _mark_agent_transfer_failed(db, transfer_code, reference, failure_reason)


async def handle_charge_success_payout_side(db: AsyncSession, data: dict) -> None:
    """Loan repayments and DVA bank transfers (non-standard collection metadata)."""
    metadata = data.get("metadata") or {}
    payment_type = metadata.get("payment_type")

    if payment_type == "loan_repayment":
        reference = data.get("reference", "")
        instalment_id_str = metadata.get("instalment_id")
        business_id_str = metadata.get("business_id")
        if not instalment_id_str:
            logger.warning("paystack.charge.repayment_missing_instalment", reference=reference)
            return
        from uuid import UUID

        from apps.api.modules.lender.service import LenderService

        business_id = UUID(business_id_str) if business_id_str else None
        await LenderService(db).confirm_repayment(
            paystack_ref=reference,
            business_id=business_id,
        )
        return

    # DVA / bank transfer collections may not have a pre-created Payment row
    channel = (data.get("channel") or "").lower()
    if channel in ("dedicated_nuban", "bank", "bank_transfer") or metadata.get("dva"):
        from apps.api.modules.business.dva_service import DVAService

        await DVAService(db).handle_inbound_transfer(data)


async def _mark_agent_transfer_paid(
    db: AsyncSession, transfer_code: str, reference: str
) -> None:
    """Webhook fallback — only finalize if batch outcome not already success."""
    from datetime import datetime, timezone
    from decimal import Decimal
    from uuid import UUID

    from sqlalchemy import select

    from apps.api.modules.agent_network.models import AgentCommission, AgentPayoutBatch
    from apps.api.modules.agent_network.service import AgentNetworkService

    result = await db.execute(
        select(AgentPayoutBatch).where(
            AgentPayoutBatch.status.in_(["processing", "partial_failed"])
        )
    )
    for batch in result.scalars().all():
        results = dict(batch.results or {})
        for agent_id_str, outcome in results.items():
            if outcome.get("reference") != reference and outcome.get("transfer_code") != transfer_code:
                continue
            if outcome.get("status") == "success":
                return

            outcome["status"] = "success"
            outcome["transfer_code"] = transfer_code
            batch.results = results

            now = datetime.now(timezone.utc)
            agent_svc = AgentNetworkService(db)
            try:
                agent = await agent_svc._get_agent(UUID(agent_id_str))
                amount = Decimal(str(outcome.get("amount", "0")))
                await agent_svc.finalize_agent_payout_success(
                    agent_id=UUID(agent_id_str),
                    amount=amount,
                    batch_id=batch.id,
                    transfer_code=transfer_code,
                    paid_via="momo",
                )
            except Exception as exc:
                logger.warning(
                    "paystack.agent_paid_update_error",
                    agent_id=agent_id_str,
                    error=str(exc),
                )
            return


async def _mark_agent_transfer_failed(
    db: AsyncSession, transfer_code: str, reference: str, reason: str
) -> None:
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import AgentPayoutBatch

    result = await db.execute(
        select(AgentPayoutBatch).where(
            AgentPayoutBatch.status.in_(["processing", "partial_failed"])
        )
    )
    for batch in result.scalars().all():
        results = dict(batch.results or {})
        for agent_id_str, outcome in results.items():
            if outcome.get("reference") != reference and outcome.get("transfer_code") != transfer_code:
                continue
            if outcome.get("status") == "failed":
                return
            outcome["status"] = "failed"
            outcome["error"] = reason
            batch.results = results
            return
