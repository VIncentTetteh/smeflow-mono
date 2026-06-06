"""
Payout management API — admin and agent-facing endpoints.

Admin routes  (/admin/payouts/*):
  GET  /balance             Platform Paystack balance
  GET  /agents/summary      Aggregate wallet across all agents
  GET  /batches             List payout batches
  GET  /batches/{id}        Batch detail + per-agent results
  POST /agents/trigger      Manually trigger weekly payout
  GET  /loans/pending       Loans awaiting disbursement
  POST /loans/{id}/disburse Trigger disbursement for a confirmed loan
  POST /loans/{id}/disburse/retry  Retry a failed disbursement
  POST /lenders/{id}/setup-subaccount  Create Paystack subaccount for lender

Agent routes  (/agents/wallet):
  GET  /wallet              Balance summary + next payout date
  GET  /wallet/history      Payout batch history
  GET  /wallet/commissions  Commission list with status + available_at
"""

from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_user_id
from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.modules.agent_network.models import Agent, AgentCommission, AgentPayoutBatch
from apps.api.modules.agent_network.service import AgentNetworkService
from apps.api.modules.credit.models import LoanRequest
from apps.api.modules.credit.service import CreditService

logger = structlog.get_logger()

admin_router = APIRouter()
agent_router = APIRouter()


# ── Dependency: require platform admin (lazy import to avoid circular) ────────

async def _require_admin(request: "Request", db: AsyncSession = Depends(get_db)) -> UUID:
    from fastapi import Request  # noqa: F401 — used in signature above
    from apps.api.modules.admin.router import _require_platform_admin
    return await _require_platform_admin(request, db)


from typing import Annotated
from fastapi import Request  # needed for _require_admin signature

PlatformAdmin = Annotated[UUID, Depends(_require_admin)]


# ─────────────────────────────────────────────────────────────────────────────
# ADMIN ROUTES
# ─────────────────────────────────────────────────────────────────────────────


@admin_router.get("/balance")
async def get_platform_balance(actor_id: PlatformAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Return current Paystack balance for the platform account."""
    from apps.api.core.config import get_settings
    from libs.payment_clients.paystack import PaystackClient

    settings = get_settings()
    if not settings.PAYSTACK_SECRET_KEY:
        raise HTTPException(503, "Paystack not configured")

    client = PaystackClient()
    try:
        balances = await client.get_balance()
    finally:
        await client._close()

    # Calculate pending payout liability
    pending_liability = (
        await db.execute(select(func.sum(Agent.available_balance)).where(Agent.is_active.is_(True)))
    ).scalar_one() or 0

    return {
        "paystack_balances": balances,
        "pending_payout_liability_ghs": str(pending_liability),
    }


@admin_router.get("/agents/summary")
async def agent_payout_summary(actor_id: PlatformAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Aggregate wallet stats across all active agents."""
    result = await db.execute(
        select(
            func.count(Agent.id).label("total_agents"),
            func.sum(Agent.pending_balance).label("total_pending"),
            func.sum(Agent.available_balance).label("total_available"),
            func.sum(Agent.total_paid_out).label("total_paid_out"),
        ).where(Agent.is_active.is_(True))
    )
    row = result.one()

    # Count agents eligible for next payout
    eligible = (
        await db.execute(
            select(func.count(Agent.id)).where(
                Agent.is_active.is_(True),
                Agent.available_balance >= Agent.payout_threshold,
            )
        )
    ).scalar_one()

    return {
        "total_active_agents": row.total_agents or 0,
        "total_pending_balance_ghs": str(row.total_pending or 0),
        "total_available_balance_ghs": str(row.total_available or 0),
        "total_paid_out_ghs": str(row.total_paid_out or 0),
        "agents_eligible_for_payout": eligible,
    }


@admin_router.get("/batches")
async def list_payout_batches(
    actor_id: PlatformAdmin,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List AgentPayoutBatch records, newest first."""
    total = (await db.execute(select(func.count(AgentPayoutBatch.id)))).scalar_one()
    rows = (
        await db.execute(
            select(AgentPayoutBatch)
            .order_by(AgentPayoutBatch.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    items = [
        {
            "id": str(b.id),
            "status": b.status,
            "total_amount_ghs": str(b.total_amount),
            "agent_count": b.agent_count,
            "transfer_count": b.transfer_count,
            "paystack_batch_ref": b.paystack_batch_ref,
            "created_at": b.created_at.isoformat(),
            "completed_at": b.completed_at.isoformat() if b.completed_at else None,
            "initiated_by": str(b.initiated_by) if b.initiated_by else "SYSTEM",
        }
        for b in rows
    ]
    return {"total": total, "items": items}


@admin_router.get("/batches/{batch_id}")
async def get_payout_batch(actor_id: PlatformAdmin, batch_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    """Batch detail including per-agent transfer outcomes."""
    result = await db.execute(
        select(AgentPayoutBatch).where(AgentPayoutBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Payout batch not found")

    return {
        "id": str(batch.id),
        "status": batch.status,
        "total_amount_ghs": str(batch.total_amount),
        "agent_count": batch.agent_count,
        "transfer_count": batch.transfer_count,
        "paystack_batch_ref": batch.paystack_batch_ref,
        "created_at": batch.created_at.isoformat(),
        "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
        "initiated_by": str(batch.initiated_by) if batch.initiated_by else "SYSTEM",
        "results": batch.results,
    }


@admin_router.post("/agents/trigger")
async def trigger_agent_payout(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Manually trigger a weekly agent payout batch outside the scheduled window."""
    from apps.api.workers.dispatch import enqueue_task
    from apps.api.workers.tasks.payout_tasks import weekly_agent_payout

    enqueue_task(weekly_agent_payout)
    logger.info("payouts.admin.manual_trigger")
    return {"queued": True, "message": "Payout batch queued — check /admin/payouts/batches shortly"}


@admin_router.get("/loans/pending")
async def list_pending_disbursements(
    actor_id: PlatformAdmin,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List loan requests in 'confirmed' or 'disbursing' states awaiting disbursement."""
    total = (
        await db.execute(
            select(func.count(LoanRequest.id)).where(
                LoanRequest.status.in_(["confirmed", "disbursing"])
            )
        )
    ).scalar_one()

    rows = (
        await db.execute(
            select(LoanRequest)
            .where(LoanRequest.status.in_(["confirmed", "disbursing"]))
            .order_by(LoanRequest.confirmed_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    items = [
        {
            "loan_id": str(r.id),
            "business_id": str(r.business_id),
            "lender_id": r.lender_id,
            "amount_approved_ghs": str(r.amount_approved),
            "disbursement_phone": r.disbursement_phone,
            "disbursement_transfer_code": r.disbursement_transfer_code,
            "status": r.status,
            "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
        }
        for r in rows
    ]
    return {"total": total, "items": items}


@admin_router.post("/loans/{loan_id}/disburse")
async def disburse_loan(
    actor_id: PlatformAdmin,
    loan_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Trigger MoMo disbursement for a confirmed loan."""
    from apps.api.core.config import get_settings

    settings = get_settings()
    if not settings.PAYSTACK_SECRET_KEY:
        raise HTTPException(503, "Paystack not configured")

    svc = CreditService(db)
    try:
        loan = await svc.initiate_disbursement(loan_id)
        await db.commit()
    except (NotFoundError, ConflictError) as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "loan_id": str(loan.id),
        "status": loan.status,
        "disbursement_transfer_code": loan.disbursement_transfer_code,
        "disbursement_phone": loan.disbursement_phone,
    }


@admin_router.post("/loans/{loan_id}/disburse/retry")
async def retry_disbursement(actor_id: PlatformAdmin, loan_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    """Queue a disbursement retry for a loan that previously failed."""
    from apps.api.workers.dispatch import enqueue_task
    from apps.api.workers.tasks.payout_tasks import retry_failed_disbursement

    # Verify loan exists and is in a retriable state
    result = await db.execute(select(LoanRequest).where(LoanRequest.id == loan_id))
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(404, "Loan not found")
    if loan.status not in ("confirmed", "disbursing"):
        raise HTTPException(400, f"Loan is in '{loan.status}' state — cannot retry disbursement")

    enqueue_task(retry_failed_disbursement, str(loan_id))
    return {"queued": True, "loan_id": str(loan_id)}


@admin_router.post("/lenders/{lender_id}/setup-subaccount")
async def setup_lender_subaccount(
    actor_id: PlatformAdmin,
    lender_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Provision Paystack subaccount + split for a lender.
    Body: { settlement_bank_code, settlement_account_number, platform_fee_percent }
    """
    from apps.api.modules.lender.service import LenderService

    required = ("settlement_bank_code", "settlement_account_number", "platform_fee_percent")
    missing = [k for k in required if k not in body]
    if missing:
        raise HTTPException(400, f"Missing fields: {missing}")

    svc = LenderService(db)
    try:
        partner = await svc.provision_paystack_subaccount(
            lender_id=lender_id,
            settlement_bank_code=body["settlement_bank_code"],
            settlement_account_number=body["settlement_account_number"],
            platform_fee_percent=float(body["platform_fee_percent"]),
        )
        await db.commit()
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "lender_id": lender_id,
        "paystack_subaccount_code": partner.paystack_subaccount_code,
        "paystack_split_code": partner.paystack_split_code,
        "platform_fee_percent": partner.platform_fee_percent,
    }


# ─────────────────────────────────────────────────────────────────────────────
# AGENT ROUTES
# ─────────────────────────────────────────────────────────────────────────────


async def _current_agent_id_for_wallet(user_id: UUID, db: AsyncSession) -> UUID:
    result = await db.execute(select(Agent).where(Agent.user_id == user_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent profile not found")
    return agent.id


@agent_router.get("/wallet")
async def get_wallet(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return wallet summary for the authenticated agent."""
    agent_id = await _current_agent_id_for_wallet(user_id, db)
    svc = AgentNetworkService(db)
    return await svc.get_agent_wallet(agent_id)


@agent_router.get("/wallet/history")
async def get_payout_history(
    limit: int = 20,
    offset: int = 0,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return payout batch history for the authenticated agent."""
    agent_id = await _current_agent_id_for_wallet(user_id, db)

    # Find batches that include this agent
    result = await db.execute(
        select(AgentPayoutBatch)
        .where(AgentPayoutBatch.status.in_(["completed", "partial_failed", "failed"]))
        .order_by(AgentPayoutBatch.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    batches = result.scalars().all()

    agent_id_str = str(agent_id)
    history = []
    for batch in batches:
        agent_result = (batch.results or {}).get(agent_id_str)
        if agent_result:
            history.append(
                {
                    "batch_id": str(batch.id),
                    "amount_ghs": agent_result.get("amount"),
                    "transfer_code": agent_result.get("transfer_code"),
                    "status": agent_result.get("status"),
                    "payout_date": batch.created_at.isoformat(),
                    "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
                }
            )

    return {"items": history, "total": len(history)}


@agent_router.get("/wallet/commissions")
async def get_commission_detail(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return commission list with status and available_at for the authenticated agent."""
    agent_id = await _current_agent_id_for_wallet(user_id, db)

    query = select(AgentCommission).where(AgentCommission.agent_id == agent_id)
    if status:
        query = query.where(AgentCommission.status == status)

    total = (
        await db.execute(
            select(func.count(AgentCommission.id)).where(
                AgentCommission.agent_id == agent_id,
                *([AgentCommission.status == status] if status else []),
            )
        )
    ).scalar_one()

    rows = (
        await db.execute(
            query.order_by(AgentCommission.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()

    items = [
        {
            "id": str(c.id),
            "trigger": c.trigger,
            "amount_ghs": str(c.amount),
            "status": c.status,
            "created_at": c.created_at.isoformat(),
            "available_at": c.available_at.isoformat() if c.available_at else None,
            "paid_at": c.paid_at.isoformat() if c.paid_at else None,
            "paid_via": c.paid_via,
        }
        for c in rows
    ]
    return {"total": total, "items": items}


class AgentWithdrawRequest(BaseModel):
    amount: float


@agent_router.post("/withdraw")
async def withdraw_agent_balance(
    body: AgentWithdrawRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    On-demand withdrawal for an agent.
    Validates available balance >= payout_threshold, initiates Paystack transfer.
    """
    from decimal import Decimal

    agent_id = await _current_agent_id_for_wallet(user_id, db)
    svc = AgentNetworkService(db)
    try:
        result = await svc.initiate_agent_withdrawal(agent_id, Decimal(str(body.amount)))
        await db.commit()
        return result
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.error("agent.withdrawal.error", agent_id=str(agent_id), error=str(exc))
        raise HTTPException(500, "Withdrawal failed — please try again") from exc
