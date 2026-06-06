"""Sales endpoints."""

from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    PaginationParams,
    RequireRole,
    get_current_business_id,
    get_current_user_id,
)
from apps.api.core.exceptions import NotFoundError, SMEFlowError
from apps.api.core.idempotency import idempotency_store
from apps.api.core.middleware import limiter
from apps.api.modules.sales.models import Sale
from apps.api.modules.sales.schemas import (
    BatchSyncPayload,
    CreditRepaymentIntentCreate,
    CustomerDetailResponse,
    CustomerListItem,
    CustomerListResponse,
    CustomerRecentSale,
    CustomerStats,
    CustomerTopItem,
    DailySummary,
    MomoSaleIntentResponse,
    PaymentIntentResponse,
    PeriodSummary,
    RecordPayment,
    SaleCreate,
    SaleRecordResponse,
    SaleResponse,
)
from apps.api.modules.sales.service import SalesService

router = APIRouter()


@router.post("/record", response_model=SaleRecordResponse, status_code=201)
@limiter.limit("300/minute")
async def record_sale(
    request: Request,
    body: SaleCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> SaleRecordResponse:
    """
    Record a sale. Atomically deducts inventory and queues invoice generation.
    Pass an `idempotency_key` (UUID) — safe to retry on network failures.
    """
    svc = SalesService(db)
    return await svc.record_sale(business_id, user_id, body)


@router.post("/momo/intents", response_model=MomoSaleIntentResponse, status_code=201, deprecated=True)
@limiter.limit("120/minute")
async def create_momo_sale_intent(
    request: Request,
    body: dict,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> MomoSaleIntentResponse:
    """Deprecated: use Paystack unified checkout for all new electronic payments."""
    raise SMEFlowError(
        "Direct MoMo RequestToPay is deprecated. Use Paystack unified checkout.",
        "MOMO_REQUEST_TO_PAY_DEPRECATED",
        410,
    )


@router.get("/momo/intents/{payment_id}", response_model=MomoSaleIntentResponse)
async def get_momo_sale_intent(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> MomoSaleIntentResponse:
    svc = SalesService(db)
    return await svc.get_momo_sale_intent(business_id, payment_id)


@router.post("/momo/intents/{payment_id}/verify", response_model=MomoSaleIntentResponse)
async def verify_momo_sale_intent(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> MomoSaleIntentResponse:
    svc = SalesService(db)
    return await svc.verify_momo_sale_intent(business_id, payment_id)


@router.post("/payment-intents", response_model=PaymentIntentResponse, status_code=201)
@limiter.limit("120/minute")
async def create_payment_intent(
    request: Request,
    body: SaleCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    """Create a Paystack checkout link without leaving the merchant's POS."""
    return await SalesService(db).create_paystack_sale_intent(business_id, user_id, body)


@router.get("/payment-intents/{payment_id}", response_model=PaymentIntentResponse)
async def get_payment_intent(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    return await SalesService(db).get_paystack_sale_intent(business_id, payment_id)


@router.post("/payment-intents/{payment_id}/verify", response_model=PaymentIntentResponse)
async def verify_payment_intent(
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    return await SalesService(db).verify_paystack_sale_intent(business_id, payment_id)


@router.post("/batch", response_model=dict, status_code=200)
@limiter.limit("300/minute")
async def batch_sync(
    request: Request,
    body: BatchSyncPayload,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Sync up to 100 offline-recorded sales in one request (idempotent)."""
    svc = SalesService(db)
    results = []
    for sale_data in body.sales:
        try:
            cached = await idempotency_store.get(business_id, sale_data.idempotency_key)
            if cached:
                results.append(
                    {
                        "idempotency_key": sale_data.idempotency_key,
                        "status": "duplicate",
                        "sale_id": str(cached.get("sale_id")) if cached.get("sale_id") else None,
                    }
                )
                continue
            result = await svc.record_sale(business_id, user_id, sale_data)
            results.append(
                {
                    "idempotency_key": sale_data.idempotency_key,
                    "status": "success",
                    "sale_id": str(result.sale_id),
                }
            )
        except Exception as e:
            results.append(
                {"idempotency_key": sale_data.idempotency_key, "status": "failed", "error": str(e)}
            )
    return {"processed": len(results), "results": results}


@router.get("", response_model=list[SaleResponse])
async def list_sales(
    business_id: UUID = Depends(get_current_business_id),
    status: str | None = Query(None),
    payment_method: str | None = Query(None),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> list[SaleResponse]:
    q = (
        select(Sale)
        .where(Sale.business_id == business_id)
        .options(selectinload(Sale.items), selectinload(Sale.receivable))
        .order_by(Sale.created_at.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
    )
    if status:
        q = q.where(Sale.status == status)
    if payment_method:
        q = q.where(Sale.payment_method == payment_method)
    if from_date:
        q = q.where(Sale.created_at >= from_date)
    if to_date:
        q = q.where(Sale.created_at < to_date + timedelta(days=1))
    result = await db.execute(q)
    return [SaleResponse.model_validate(s) for s in result.scalars().all()]


@router.get("/summary/daily", response_model=DailySummary)
async def daily_summary(
    business_id: UUID = Depends(get_current_business_id),
    date: str = Query(default_factory=lambda: str(date.today())),
    db: AsyncSession = Depends(get_db),
) -> DailySummary:
    svc = SalesService(db)
    data = await svc.get_daily_summary(business_id, date)
    return DailySummary(**data)


@router.get("/summary/period", response_model=PeriodSummary)
async def period_summary(
    business_id: UUID = Depends(get_current_business_id),
    from_date: str = Query(..., description="Start date ISO-8601 (YYYY-MM-DD)"),
    to_date: str = Query(..., description="End date ISO-8601 (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
) -> PeriodSummary:
    """Aggregate revenue by payment method over an arbitrary date range."""
    svc = SalesService(db)
    data = await svc.get_period_summary(business_id, from_date, to_date)
    return PeriodSummary(**data)


# ── Customer CRM ───────────────────────────────────────────────────────────────


@router.get("/customers", response_model=CustomerListResponse)
async def list_customers(
    search: str | None = Query(None, description="Search by name or phone"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> CustomerListResponse:
    """List all customers with lifetime value, total purchases, and outstanding credit."""

    from sqlalchemy import case, func

    from apps.api.modules.sales.models import Customer, Sale

    q = (
        select(
            Customer.id,
            Customer.name,
            Customer.phone,
            Customer.created_at,
            func.count(Sale.id).label("purchase_count"),
            func.coalesce(func.sum(Sale.total), 0).label("lifetime_value"),
            func.coalesce(
                func.sum(case((Sale.payment_method == "credit", Sale.balance_due), else_=0)), 0
            ).label("outstanding_credit"),
            func.max(Sale.created_at).label("last_purchase_at"),
        )
        .outerjoin(Sale, (Sale.customer_id == Customer.id) & (Sale.status != "voided"))
        .where(Customer.business_id == business_id)
        .group_by(Customer.id)
        .order_by(func.coalesce(func.sum(Sale.total), 0).desc())
    )
    count_q = select(func.count(Customer.id)).where(Customer.business_id == business_id)

    if search:
        pattern = f"%{search}%"
        q = q.where(Customer.name.ilike(pattern) | Customer.phone.ilike(pattern))
        count_q = count_q.where(Customer.name.ilike(pattern) | Customer.phone.ilike(pattern))

    total = (await db.execute(count_q)).scalar_one()
    rows = (await db.execute(q.limit(limit).offset(offset))).all()

    return CustomerListResponse(
        total=total,
        items=[
            CustomerListItem(
                id=r.id,
                name=r.name,
                phone=r.phone,
                purchase_count=r.purchase_count,
                lifetime_value=r.lifetime_value or 0,
                outstanding_credit=r.outstanding_credit or 0,
                last_purchase_at=r.last_purchase_at,
                since=r.created_at,
            )
            for r in rows
        ],
    )


@router.get("/customers/{customer_id}", response_model=CustomerDetailResponse)
async def get_customer(
    customer_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> CustomerDetailResponse:
    """Full customer profile: purchase history, top items, credit standing."""

    from sqlalchemy import func

    from apps.api.modules.sales.models import Customer, Sale, SaleItem

    cust_result = await db.execute(
        select(Customer).where(Customer.id == customer_id, Customer.business_id == business_id)
    )
    customer = cust_result.scalar_one_or_none()
    if not customer:
        raise NotFoundError("Customer", str(customer_id))

    # Aggregate totals
    agg = (
        await db.execute(
            select(
                func.count(Sale.id).label("purchase_count"),
                func.coalesce(func.sum(Sale.total), 0).label("lifetime_value"),
                func.coalesce(func.sum(Sale.amount_paid), 0).label("total_paid"),
                func.coalesce(func.sum(Sale.balance_due), 0).label("outstanding_credit"),
                func.max(Sale.created_at).label("last_purchase_at"),
            ).where(Sale.customer_id == customer_id, Sale.status != "voided")
        )
    ).one()

    # Top 5 items by revenue
    top_items_result = await db.execute(
        select(
            SaleItem.description,
            func.sum(SaleItem.qty).label("total_qty"),
            func.sum(SaleItem.line_total).label("total_revenue"),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.customer_id == customer_id, Sale.status != "voided")
        .group_by(SaleItem.description)
        .order_by(func.sum(SaleItem.line_total).desc())
        .limit(5)
    )
    top_items = [
        CustomerTopItem(
            description=r.description,
            total_qty=r.total_qty or 0,
            total_revenue=r.total_revenue or 0,
        )
        for r in top_items_result.all()
    ]

    # Recent 10 sales
    recent_sales = (
        (
            await db.execute(
                select(Sale)
                .where(Sale.customer_id == customer_id, Sale.status != "voided")
                .order_by(Sale.created_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )

    return CustomerDetailResponse(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        since=customer.created_at,
        stats=CustomerStats(
            purchase_count=agg.purchase_count,
            lifetime_value=agg.lifetime_value or 0,
            total_paid=agg.total_paid or 0,
            outstanding_credit=agg.outstanding_credit or 0,
            last_purchase_at=agg.last_purchase_at,
        ),
        top_items=top_items,
        recent_sales=[
            CustomerRecentSale(
                id=s.id,
                total=s.total,
                payment_method=s.payment_method,
                status=s.status,
                created_at=s.created_at,
            )
            for s in recent_sales
        ],
    )


@router.get("/{sale_id}", response_model=SaleResponse)
async def get_sale(
    sale_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> SaleResponse:
    result = await db.execute(
        select(Sale)
        .where(Sale.id == sale_id)
        .options(selectinload(Sale.items), selectinload(Sale.receivable))
    )
    sale = result.scalar_one_or_none()
    if not sale or sale.business_id != business_id:
        raise NotFoundError("Sale", str(sale_id))
    return SaleResponse.model_validate(sale)


@router.post("/{sale_id}/void", response_model=SaleResponse)
async def void_sale(
    sale_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> SaleResponse:
    svc = SalesService(db)
    sale = await svc.void_sale(business_id, sale_id, user_id)
    return SaleResponse.model_validate(sale)


@router.post("/{sale_id}/pay", response_model=SaleResponse)
async def record_payment(
    sale_id: UUID,
    body: RecordPayment,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> SaleResponse:
    """Record a partial or full payment against a credit sale."""
    svc = SalesService(db)
    sale = await svc.record_payment(
        business_id, sale_id, body.amount, user_id, body.payment_method, body.notes
    )
    return SaleResponse.model_validate(sale)


@router.post("/{sale_id}/repayment-intents", response_model=PaymentIntentResponse, status_code=201)
async def create_credit_repayment_intent(
    sale_id: UUID,
    body: CreditRepaymentIntentCreate,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    return await SalesService(db).create_credit_repayment_intent(
        business_id, sale_id, body.amount, body.idempotency_key
    )


@router.post(
    "/{sale_id}/repayment-intents/{payment_id}/verify", response_model=PaymentIntentResponse
)
async def verify_credit_repayment_intent(
    sale_id: UUID,
    payment_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    return await SalesService(db).verify_credit_repayment_intent(
        business_id, sale_id, payment_id
    )


@router.post("/{sale_id}/retry-payment", response_model=dict)
async def retry_sale_payment(
    sale_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager", "staff")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-send the MoMo RequestToPay prompt for a pending or failed sale payment."""
    return await SalesService(db).retry_momo_payment(business_id, sale_id)
