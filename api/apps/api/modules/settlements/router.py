"""
Merchant Settlement API.

GET    /settlements/balance      Wallet summary
GET    /settlements/ledger       Paginated ledger
GET    /settlements              Settlement history
GET    /settlements/preview      Compute fee/net for a given withdrawal amount (no side effects)
POST   /settlements/request      Submit a withdrawal request
DELETE /settlements/{id}         Cancel a pending settlement
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_business_id, get_current_user_id
from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.modules.settlements.service import MerchantSettlementService

logger = structlog.get_logger()
router = APIRouter()


class SettlementRequestBody(BaseModel):
    amount: Decimal = Field(..., gt=0, description="Amount in GHS to withdraw")


@router.get("/preview")
async def preview_settlement(
    amount: Decimal = Query(..., gt=0, description="Withdrawal amount in GHS"),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Return the authoritative server-computed fee and net amount for a given withdrawal.

    This is a read-only endpoint — no settlement is created or modified.
    Call this before showing the merchant the confirmation screen so the fee
    display matches what the server will actually deduct.
    """
    from apps.api.modules.settlements.service import settlement_payout_amounts

    svc = MerchantSettlementService(db)
    balance = await svc.get_merchant_balance(business_id)
    unsettled = Decimal(str(balance.get("unsettled_balance", "0")))
    min_amount = Decimal(str(balance.get("min_settlement_ghs", "10")))
    ceiling = Decimal(str(balance.get("auto_approve_ceiling_ghs", "5000")))

    if amount > unsettled:
        return {
            "gross_amount": str(amount),
            "transfer_fee": "0.00",
            "net_amount": str(amount),
            "can_settle": False,
            "reason": "insufficient_balance",
            "unsettled_balance": str(unsettled),
        }

    if amount < min_amount:
        return {
            "gross_amount": str(amount),
            "transfer_fee": "0.00",
            "net_amount": str(amount),
            "can_settle": False,
            "reason": f"below_minimum_{min_amount}",
            "unsettled_balance": str(unsettled),
        }

    fee, net = settlement_payout_amounts(amount)
    return {
        "gross_amount": str(amount),
        "transfer_fee": str(fee),
        "net_amount": str(net),
        "can_settle": True,
        "requires_admin_approval": amount > ceiling,
        "auto_approve_ceiling_ghs": str(ceiling),
        "unsettled_balance": str(unsettled),
    }


@router.get("/balance")
async def get_settlement_balance(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Return the merchant's settlement wallet summary.

    Includes unsettled balance, platform fee rate, settlement threshold,
    whether auto-settlement is enabled, and next auto-settlement date.
    """
    svc = MerchantSettlementService(db)
    return await svc.get_merchant_balance(business_id)


@router.get("/ledger")
async def get_settlement_ledger(
    type: str | None = Query(None, description="Filter by entry type: credit, fee, debit, reversal, adjustment"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Return paginated ledger entries for the authenticated merchant.

    Each entry shows: type, amount (signed), running balance_after, description, date.
    Use type= to filter to a specific entry type.
    """
    svc = MerchantSettlementService(db)
    return await svc.get_ledger(
        business_id=business_id,
        limit=limit,
        offset=offset,
        entry_type=type,
    )


@router.get("")
async def list_settlements(
    status: str | None = Query(None, description="Filter by status: pending, approved, processing, completed, failed, cancelled"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Return paginated settlement request history for the authenticated merchant.
    """
    svc = MerchantSettlementService(db)
    return await svc.get_settlement_history(
        business_id=business_id,
        limit=limit,
        offset=offset,
        status=status,
    )


@router.post("/request", status_code=201)
async def request_settlement(
    body: SettlementRequestBody,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Submit a withdrawal request for your unsettled balance.

    Validation gates:
    - KYC must be verified
    - Primary verified MoMo account must exist
    - No settlement already in progress
    - Amount between GHS 10 and GHS 50,000
    - Amount does not exceed unsettled balance

    Requests at or below SETTLEMENT_AUTO_APPROVE_CEILING_GHS are auto-approved
    and disbursed immediately. Larger requests require admin approval.
    Platform fees are shown in the ledger at collection time only.
    """
    svc = MerchantSettlementService(db)
    try:
        settlement = await svc.request_settlement(
            business_id=business_id,
            amount=body.amount,
            requested_by=user_id,
            mode="manual",
        )
        await db.commit()
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "settlement_id": str(settlement.id),
        "status": settlement.status,
        "amount": str(settlement.amount),
        "fee_amount": str(settlement.fee_amount),
        "net_amount": str(settlement.net_amount),
        "destination_phone": settlement.destination_phone,
        "destination_provider": settlement.destination_provider,
        "message": (
            "Your withdrawal is being processed and will arrive shortly."
            if settlement.status == "processing"
            else "Your withdrawal request is pending admin approval."
        ),
    }


@router.delete("/{settlement_id}", status_code=200)
async def cancel_settlement(
    settlement_id: UUID,
    reason: str = Body(default="", embed=True),
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Cancel a pending settlement request.
    Only settlements in 'pending' status can be cancelled.
    """
    svc = MerchantSettlementService(db)

    # Verify this settlement belongs to the authenticated merchant
    from sqlalchemy import select
    from apps.api.modules.settlements.models import MerchantSettlement

    result = await db.execute(
        select(MerchantSettlement).where(
            MerchantSettlement.id == settlement_id,
            MerchantSettlement.business_id == business_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Settlement not found")

    try:
        settlement = await svc.cancel_settlement(
            settlement_id=settlement_id,
            actor_id=user_id,
            reason=reason,
        )
        await db.commit()
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {
        "settlement_id": str(settlement.id),
        "status": settlement.status,
        "message": "Settlement cancelled. Your balance has been restored.",
    }
