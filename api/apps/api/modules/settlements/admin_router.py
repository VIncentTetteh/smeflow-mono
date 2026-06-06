"""
Admin Settlement API — Phase 3 endpoints.

GET    /admin/settlements              All settlements (filterable by status)
GET    /admin/settlements/pending      Settlements awaiting approval
GET    /admin/settlements/summary      Platform-level liability + volume summary
POST   /admin/settlements/trigger      Manually trigger daily auto-settlement
POST   /admin/settlements/{id}/approve Approve a pending settlement
POST   /admin/settlements/{id}/cancel  Cancel with reason
GET    /admin/merchants/{id}/balance   Balance + ledger for a specific merchant
POST   /admin/merchants/{id}/settle    Force-settle a specific merchant
PATCH  /admin/merchants/{id}/settlement-config  Toggle enabled / update threshold (canonical)
       /admin/settlements/merchants/{id}/settlement-config  Alias (same handler)
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.modules.settlements.service import MerchantSettlementService

logger = structlog.get_logger()
router = APIRouter()


# ── Auth dependency ───────────────────────────────────────────────────────────

async def _require_admin(request: "Request", db: AsyncSession = Depends(get_db)) -> UUID:
    from fastapi import Request  # noqa: F401
    from apps.api.modules.admin.router import _require_platform_admin
    return await _require_platform_admin(request, db)


from typing import Annotated
from fastapi import Request

PlatformAdmin = Annotated[UUID, Depends(_require_admin)]


# ── Request bodies ────────────────────────────────────────────────────────────

class ForceSettleBody(BaseModel):
    amount: Decimal = Field(..., gt=0, description="Amount in GHS to settle")


class SettlementConfigBody(BaseModel):
    settlement_enabled: bool | None = None
    settlement_threshold: Decimal | None = Field(
        None, gt=0, description="Minimum GHS balance before auto-settlement fires"
    )


class BulkApproveBody(BaseModel):
    settlement_ids: list[UUID] = Field(..., min_length=1, max_length=100)


# ── Settlement list & summary ─────────────────────────────────────────────────

@router.get("/summary")
async def admin_settlement_summary(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Platform settlement dashboard: liability, pending approvals, in-flight transfers,
    today's volume/failures, platform fees collected, paused merchants, and config.
    """
    return await MerchantSettlementService(db).get_admin_summary()


@router.get("")
async def admin_list_settlements(
    actor_id: PlatformAdmin,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """All settlements across all merchants, newest first. Filter by status."""
    return await MerchantSettlementService(db).list_all_settlements(
        status=status, limit=limit, offset=offset
    )


@router.get("/pending")
async def admin_list_pending_settlements(
    actor_id: PlatformAdmin,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """All settlements awaiting admin approval (status=pending)."""
    return await MerchantSettlementService(db).list_all_settlements(
        status="pending", limit=limit, offset=offset
    )


# ── Settlement actions ────────────────────────────────────────────────────────

@router.post("/trigger")
async def trigger_auto_settlement(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Manually trigger the daily auto-settlement batch outside the 08:00 schedule."""
    from apps.api.workers.tasks.payout_tasks import daily_merchant_auto_settlement

    daily_merchant_auto_settlement.apply_async(args=[str(actor_id)])
    logger.info("settlement.admin.manual_trigger", admin_id=str(actor_id))
    return {
        "queued": True,
        "message": "Auto-settlement batch queued — check /admin/settlements shortly.",
    }


@router.post("/{settlement_id}/approve")
async def admin_approve_settlement(
    settlement_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve a pending settlement and trigger immediate disbursement."""
    svc = MerchantSettlementService(db)
    try:
        settlement = await svc.approve_settlement(
            settlement_id=settlement_id, admin_id=actor_id
        )
        await db.commit()
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "settlement_id": str(settlement.id),
        "status": settlement.status,
        "paystack_transfer_code": settlement.paystack_transfer_code,
        "net_amount": str(settlement.net_amount),
    }


@router.post("/bulk-approve")
async def admin_bulk_approve_settlements(
    body: BulkApproveBody,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve several pending settlements and report per-row results."""
    svc = MerchantSettlementService(db)
    approved: list[dict] = []
    failed: list[dict] = []
    for settlement_id in body.settlement_ids:
        try:
            settlement = await svc.approve_settlement(
                settlement_id=settlement_id, admin_id=actor_id
            )
            approved.append(
                {
                    "settlement_id": str(settlement.id),
                    "status": settlement.status,
                    "net_amount": str(settlement.net_amount),
                }
            )
        except (NotFoundError, ConflictError, ValueError) as exc:
            failed.append({"settlement_id": str(settlement_id), "error": str(exc)})
    await db.commit()
    return {"approved": approved, "failed": failed}


@router.post("/{settlement_id}/cancel")
async def admin_cancel_settlement(
    settlement_id: UUID,
    actor_id: PlatformAdmin,
    reason: str = Body(default="Cancelled by admin", embed=True),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cancel a pending settlement with a reason."""
    svc = MerchantSettlementService(db)
    try:
        settlement = await svc.cancel_settlement(
            settlement_id=settlement_id, actor_id=actor_id, reason=reason
        )
        await db.commit()
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc

    return {
        "settlement_id": str(settlement.id),
        "status": settlement.status,
        "reason": settlement.failure_reason,
    }


@router.post("/{settlement_id}/retry")
async def admin_retry_settlement(
    settlement_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Queue retry for a failed merchant settlement transfer."""
    from sqlalchemy import select

    from apps.api.modules.settlements.models import MerchantSettlement
    from apps.api.workers.tasks.payout_tasks import retry_failed_merchant_settlement

    result = await db.execute(
        select(MerchantSettlement).where(MerchantSettlement.id == settlement_id)
    )
    settlement = result.scalar_one_or_none()
    if not settlement:
        raise HTTPException(404, "Settlement not found")
    if settlement.status != "failed":
        raise HTTPException(409, f"Settlement is '{settlement.status}', not failed")
    retry_failed_merchant_settlement.apply_async(args=[str(settlement_id)])
    logger.info("settlement.admin.retry_queued", admin_id=str(actor_id), settlement_id=str(settlement_id))
    return {"queued": True, "settlement_id": str(settlement_id)}


# ── Per-merchant admin controls ───────────────────────────────────────────────

@router.get("/merchants/{business_id}/balance")
async def admin_merchant_balance(
    business_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Balance summary + recent ledger for a specific merchant."""
    svc = MerchantSettlementService(db)
    try:
        balance = await svc.get_merchant_balance(business_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc

    ledger = await svc.get_ledger(business_id=business_id, limit=10, offset=0)
    return {**balance, "recent_ledger": ledger["items"]}


@router.post("/merchants/{business_id}/settle")
async def admin_force_settle(
    business_id: UUID,
    body: ForceSettleBody,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Force a settlement for a specific merchant bypassing the auto-approve ceiling.
    Requires a primary verified MoMo account on the merchant.
    """
    svc = MerchantSettlementService(db)
    try:
        settlement = await svc.admin_force_settle(
            business_id=business_id,
            amount=body.amount,
            admin_id=actor_id,
        )
        await db.commit()
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "settlement_id": str(settlement.id),
        "status": settlement.status,
        "amount": str(settlement.amount),
        "fee_amount": str(settlement.fee_amount),
        "net_amount": str(settlement.net_amount),
        "paystack_transfer_code": settlement.paystack_transfer_code,
    }


@router.patch("/merchants/{business_id}/settlement-config")
async def update_merchant_settlement_config(
    business_id: UUID,
    body: SettlementConfigBody,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Toggle settlement_enabled or update settlement_threshold for a merchant.
    Used to pause settlements for a merchant (e.g. suspected fraud) or
    adjust the auto-settlement trigger threshold.
    """
    if body.settlement_enabled is None and body.settlement_threshold is None:
        raise HTTPException(400, "Provide at least one field to update.")

    svc = MerchantSettlementService(db)
    try:
        result = await svc.update_settlement_config(
            business_id=business_id,
            settlement_enabled=body.settlement_enabled,
            settlement_threshold=body.settlement_threshold,
            admin_id=actor_id,
        )
        await db.commit()
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc

    return result
