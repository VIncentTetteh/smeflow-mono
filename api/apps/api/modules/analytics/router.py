"""Analytics & Reporting router."""

from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path

from apps.api.core.config import get_settings
from apps.api.core.database import get_db
from apps.api.core.dependencies import RequireFeature, get_current_business_id
from apps.api.modules.analytics.service import AnalyticsService
from apps.api.workers.dispatch import enqueue_task
from apps.api.workers.celery_app import celery

router = APIRouter()


# ── Revenue Trends ────────────────────────────────────────────────────────────

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}


class AnalyticsExportRequest(BaseModel):
    report: str = Field("revenue", description="revenue|top_items|profit_loss|cash_flow")
    format: str = Field("xlsx", description="xlsx|pdf")
    period: str = Field("30d", description="7d|30d|90d|1y")
    group_by: str = Field("day", description="day|week|month")
    limit: int = Field(10, ge=1, le=100)


_require_analytics = RequireFeature("analytics")
_require_full_analytics = RequireFeature("analytics", minimum_value="full")
_require_export = RequireFeature("export")


def _period_window(period: str) -> tuple[str, str]:
    if period not in _PERIOD_DAYS:
        raise HTTPException(400, f"period must be one of {list(_PERIOD_DAYS)}")
    today = date.today()
    return (today - timedelta(days=_PERIOD_DAYS[period])).isoformat(), today.isoformat()


@router.get("/revenue")
async def revenue_by_period(
    period: str = Query("30d", description="One of: 7d, 30d, 90d, 1y"),
    group_by: str = Query("day", description="One of: day, week, month"),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Revenue trend grouped by day / week / month for a rolling period.
    Matches the original spec: GET /analytics/revenue?period=30d&group_by=day
    """
    if group_by not in ("day", "week", "month"):
        raise HTTPException(400, "group_by must be one of: day, week, month")

    from_date, to_date = _period_window(period)

    # Require explicit dates when not polling a background job. This prevents
    # passing None into date parsing which raises TypeError (fromisoformat).
    if not from_date or not to_date:
        raise HTTPException(400, "from_date and to_date are required when job_id is not provided")

    # Require explicit dates when not polling a background job to avoid
    # calling date parsing with None values (which raises TypeError).
    if not from_date or not to_date:
        raise HTTPException(400, "from_date and to_date are required when job_id is not provided")

    # When not polling a background job, require explicit from/to dates
    # to avoid passing None to the analytics service date parsing.
    if not from_date or not to_date:
        raise HTTPException(400, "from_date and to_date are required when job_id is not provided")

    svc = AnalyticsService(db)
    rows = await svc.revenue_by_day(business_id, from_date, to_date)

    if group_by == "day":
        return rows

    # Aggregate by week or month
    from collections import defaultdict
    from decimal import Decimal as _Dec

    buckets: dict[str, dict] = defaultdict(
        lambda: {
            "total_sales": 0,
            "revenue": _Dec("0"),
            "cash": _Dec("0"),
            "momo": _Dec("0"),
            "credit": _Dec("0"),
        }
    )
    for r in rows:
        d = date.fromisoformat(r["day"])
        key = (
            f"{d.year}-W{d.isocalendar()[1]:02d}"
            if group_by == "week"
            else f"{d.year}-{d.month:02d}"
        )
        b = buckets[key]
        b["total_sales"] += r["total_sales"]
        b["revenue"] += _Dec(str(r["revenue"]))
        b["cash"] += _Dec(str(r["cash"]))
        b["momo"] += _Dec(str(r["momo"]))
        b["credit"] += _Dec(str(r["credit"]))

    return [{"period": k, **v} for k, v in sorted(buckets.items())]


@router.get("/revenue/premium")
async def premium_revenue_by_period(
    period: str = Query("30d", description="One of: 7d, 30d, 90d, 1y"),
    group_by: str = Query("day", description="One of: day, week, month"),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_analytics),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Premium-gated revenue trend alias for clients that want explicit gating."""
    return await revenue_by_period(period, group_by, business_id, db)


@router.get("/revenue/daily")
async def revenue_by_day(
    from_date: str = Query(..., description="ISO date e.g. 2024-01-01"),
    to_date: str = Query(..., description="ISO date e.g. 2024-01-31"),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Daily revenue breakdown within an explicit date range."""
    svc = AnalyticsService(db)
    return await svc.revenue_by_day(business_id, from_date, to_date)


# ── Top Items ─────────────────────────────────────────────────────────────────


@router.get("/items/top")
async def top_items(
    from_date: str = Query(...),
    to_date: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Top items by revenue in a date range."""
    svc = AnalyticsService(db)
    return await svc.top_items(business_id, from_date, to_date, limit)


@router.get("/top-items")
async def top_items_by_period(
    limit: int = Query(10, ge=1, le=50),
    period: str = Query("30d", description="One of: 7d, 30d, 90d, 1y"),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_analytics),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Premium top-items endpoint from the Phase 3 plan."""
    from_date, to_date = _period_window(period)
    svc = AnalyticsService(db)
    return await svc.top_items(business_id, from_date, to_date, limit)


# ── P&L Summary ───────────────────────────────────────────────────────────────


@router.get("/pnl")
async def pnl_summary(
    from_date: str = Query(...),
    to_date: str = Query(...),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Gross profit and margin for a date range."""
    svc = AnalyticsService(db)
    return await svc.pnl_summary(business_id, from_date, to_date)


@router.get("/profit-loss")
async def profit_loss(
    period: str = Query("monthly", description="monthly|yearly"),
    year: int = Query(..., ge=2020, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_analytics),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Premium P&L endpoint using calendar month/year periods."""
    if period not in ("monthly", "yearly"):
        raise HTTPException(400, "period must be monthly or yearly")
    if period == "monthly":
        from calendar import monthrange

        selected_month = month or date.today().month
        _, last_day = monthrange(year, selected_month)
        from_date = date(year, selected_month, 1).isoformat()
        to_date = date(year, selected_month, last_day).isoformat()
        previous_year = year if selected_month > 1 else year - 1
        previous_month = selected_month - 1 if selected_month > 1 else 12
        _, previous_last_day = monthrange(previous_year, previous_month)
        previous_from = date(previous_year, previous_month, 1).isoformat()
        previous_to = date(previous_year, previous_month, previous_last_day).isoformat()
        period_label = f"{year}-{selected_month:02d}"
        previous_label = f"{previous_year}-{previous_month:02d}"
    else:
        from_date = date(year, 1, 1).isoformat()
        to_date = date(year, 12, 31).isoformat()
        previous_from = date(year - 1, 1, 1).isoformat()
        previous_to = date(year - 1, 12, 31).isoformat()
        period_label = str(year)
        previous_label = str(year - 1)
    svc = AnalyticsService(db)
    current = await svc.pnl_summary(business_id, from_date, to_date)
    previous = await svc.pnl_summary(business_id, previous_from, previous_to)
    current_margin = current.get("gross_margin_pct", 0) or 0
    previous_margin = previous.get("gross_margin_pct", 0) or 0
    current.update(
        {
            "period": period_label,
            "previous_period": {"period": previous_label, **previous},
            "gross_margin_delta_percent": round(float(current_margin) - float(previous_margin), 2),
        }
    )
    return current


# ── Cash Flow ─────────────────────────────────────────────────────────────────


@router.get("/cash-flow")
async def cash_flow(
    from_date: str = Query(...),
    to_date: str = Query(...),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cash and MoMo inflows vs outstanding credit."""
    svc = AnalyticsService(db)
    return await svc.cash_flow(business_id, from_date, to_date)


@router.get("/cash-flow/period")
async def cash_flow_by_period(
    period: str = Query("monthly", description="monthly|yearly"),
    year: int | None = Query(None, ge=2020, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_full_analytics),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Premium cash-flow endpoint for calendar periods."""
    selected_year = year or date.today().year
    if period == "monthly":
        from calendar import monthrange

        selected_month = month or date.today().month
        _, last_day = monthrange(selected_year, selected_month)
        from_date = date(selected_year, selected_month, 1).isoformat()
        to_date = date(selected_year, selected_month, last_day).isoformat()
    elif period == "yearly":
        from_date = date(selected_year, 1, 1).isoformat()
        to_date = date(selected_year, 12, 31).isoformat()
    else:
        raise HTTPException(400, "period must be monthly or yearly")
    return await AnalyticsService(db).cash_flow(business_id, from_date, to_date)


# ── Inventory Turnover ────────────────────────────────────────────────────────


@router.get("/inventory/turnover")
async def inventory_turnover(
    from_date: str = Query(...),
    to_date: str = Query(...),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Items ranked by sales velocity."""
    svc = AnalyticsService(db)
    return await svc.inventory_turnover(business_id, from_date, to_date)


@router.get("/inventory-turnover")
async def inventory_turnover_by_period(
    period: str = Query("30d", description="One of: 7d, 30d, 90d, 1y"),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_full_analytics),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Premium inventory-turnover endpoint from the Phase 3 plan."""
    from_date, to_date = _period_window(period)
    svc = AnalyticsService(db)
    return await svc.inventory_turnover(business_id, from_date, to_date)


# ── Customer Analytics ────────────────────────────────────────────────────────


@router.get("/customers/top")
async def top_customers(
    from_date: str = Query(...),
    to_date: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Top customers by revenue."""
    svc = AnalyticsService(db)
    return await svc.customer_summary(business_id, from_date, to_date, limit)


@router.get("/customers")
async def customers_by_period(
    sort: str = Query("revenue", description="revenue|frequency"),
    period: str = Query("30d", description="One of: 7d, 30d, 90d, 1y"),
    limit: int = Query(10, ge=1, le=50),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_full_analytics),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Premium customer analytics sorted by revenue or purchase frequency."""
    if sort not in ("revenue", "frequency"):
        raise HTTPException(400, "sort must be revenue or frequency")
    from_date, to_date = _period_window(period)
    rows = await AnalyticsService(db).customer_summary(business_id, from_date, to_date, limit)
    if sort == "frequency":
        rows.sort(key=lambda row: row["purchase_count"], reverse=True)
    return rows


@router.post("/export")
async def export_analytics(
    body: AnalyticsExportRequest,
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_export),
) -> dict:
    """Queue an async analytics export to XLSX, PDF, or CSV."""
    if body.format not in ("xlsx", "pdf", "csv"):
        raise HTTPException(400, "format must be xlsx, pdf, or csv")
    if body.group_by not in ("day", "week", "month"):
        raise HTTPException(400, "group_by must be one of: day, week, month")
    if body.report not in ("revenue", "top_items", "profit_loss", "cash_flow"):
        raise HTTPException(400, "report must be revenue, top_items, profit_loss, or cash_flow")

    from apps.api.workers.tasks.analytics_tasks import export_analytics_report

    task = enqueue_task(
        export_analytics_report,
        str(business_id),
        body.report,
        body.format,
        body.period,
        body.group_by,
        body.limit,
    )
    return {
        "task_id": getattr(task, "id", None),
        "status": "queued",
        "report": body.report,
        "format": body.format,
    }


@router.get("/export/download")
async def export_analytics_sync(
    request: Request,
    report: str = Query("revenue", description="revenue|top_items|profit_loss|cash_flow"),
    export_format: str = Query("csv", description="csv|xlsx|pdf"),
    from_date: str | None = Query(None, description="ISO date e.g. 2025-01-01"),
    to_date: str | None = Query(None, description="ISO date e.g. 2025-01-31"),
    limit: int = Query(50, ge=1, le=200),
    job_id: str | None = Query(None, description="Optional Celery job id for polling"),
    raw: bool = Query(False, alias="_raw", description="Set to 1 to stream raw file for a ready job"),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_export),
    db: AsyncSession = Depends(get_db),
) -> object:
    """Synchronous analytics export — returns the file directly for download.

    Useful for single-click downloads from the dashboard UI.
    Max export window: 1 year.  For scheduled/bulk exports use POST /export.
    """
    from fastapi.responses import Response

    if export_format not in ("csv", "xlsx", "pdf"):
        raise HTTPException(400, "format must be csv, xlsx, or pdf")
    if report not in ("revenue", "top_items", "profit_loss", "cash_flow"):
        raise HTTPException(400, "invalid report type")

    # If a job_id is provided, support polling for Celery task status and streaming the
    # generated file when ready. This keeps the mobile client async polling flow working.
    if job_id:
        try:
            async_res = celery.AsyncResult(job_id)
            state = (async_res.state or "PENDING").lower()
        except Exception:
            raise HTTPException(400, "invalid job_id")

        if raw:
            # Stream raw file content when job is ready
            if state != "success":
                raise HTTPException(404, "export not ready")
            result = async_res.result or {}
            # Ensure the job belongs to the requesting business
            result_business = result.get("business_id") if isinstance(result, dict) else None
            if result_business and result_business != str(business_id):
                raise HTTPException(403, "forbidden")
            file_path = result.get("file_path") if isinstance(result, dict) else None
            if not file_path:
                raise HTTPException(404, "export file not found")
            from fastapi.responses import Response

            p = Path(file_path)
            if not p.exists():
                raise HTTPException(404, "export file not found on disk")
            if p.suffix == ".csv":
                media_type = "text/csv"
            elif p.suffix == ".xlsx":
                media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else:
                media_type = "application/pdf"
            content = p.read_bytes()
            filename = p.name
            return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})

        # Non-raw polling response — return JSON status and a download_url when ready
        base = str(request.base_url).rstrip("/")
        if state == "success":
            result = async_res.result or {}
            # Ensure the job belongs to the requesting business
            result_business = result.get("business_id") if isinstance(result, dict) else None
            if result_business and result_business != str(business_id):
                raise HTTPException(403, "forbidden")
            file_path = result.get("file_path") if isinstance(result, dict) else None
            if file_path:
                download_url = f"{base}/api/v1/analytics/export/download?job_id={job_id}&_raw=1"
            else:
                download_url = None
            return {"job_id": job_id, "status": "ready", "download_url": download_url}
        return {"job_id": job_id, "status": state}

    svc = AnalyticsService(db)
    if report == "revenue":
        rows = await svc.revenue_by_day(business_id, from_date, to_date)
        title = f"Revenue {from_date} to {to_date}"
    elif report == "top_items":
        rows = await svc.top_items(business_id, from_date, to_date, limit)
        title = f"Top Items {from_date} to {to_date}"
    elif report == "profit_loss":
        rows = [await svc.pnl_summary(business_id, from_date, to_date)]
        title = f"Profit & Loss {from_date} to {to_date}"
    else:
        rows = [await svc.cash_flow(business_id, from_date, to_date)]
        title = f"Cash Flow {from_date} to {to_date}"

    import io
    from pathlib import Path
    from tempfile import NamedTemporaryFile

    from apps.api.workers.tasks.analytics_tasks import _write_pdf, _write_xlsx

    if export_format == "csv":
        buf = io.StringIO()
        buf.write("﻿")  # BOM
        import csv

        from apps.api.workers.tasks.analytics_tasks import _headers, _stringify

        headers = _headers(rows)
        writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({h: _stringify(row.get(h)) for h in headers})
        content = buf.getvalue().encode("utf-8-sig")
        media_type = "text/csv"
        filename = f"{report}_{from_date}_{to_date}.csv"
    else:
        with NamedTemporaryFile(suffix=f".{export_format}", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        if export_format == "xlsx":
            _write_xlsx(tmp_path, title, rows)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            _write_pdf(tmp_path, title, rows)
            media_type = "application/pdf"
        content = tmp_path.read_bytes()
        tmp_path.unlink(missing_ok=True)
        filename = f"{report}_{from_date}_{to_date}.{export_format}"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Low-stock Alerts ──────────────────────────────────────────────────────────


@router.get("/inventory/alerts/low-stock")
async def low_stock_alerts(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Items currently at or below low-stock threshold."""
    svc = AnalyticsService(db)
    return await svc.low_stock_items(business_id)


# ── Phase 4: Advanced Analytics ───────────────────────────────────────────────


@router.get("/customers/advanced")
async def customer_analytics(
    from_date: str = Query(..., description="ISO date e.g. 2024-01-01"),
    to_date: str = Query(..., description="ISO date e.g. 2024-01-31"),
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_full_analytics),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Phase 4: Advanced customer analytics with segmentation and retention."""
    svc = AnalyticsService(db)
    return await svc.customer_analytics(business_id, from_date, to_date)


@router.get("/predictive/insights")
async def predictive_insights(
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_full_analytics),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Phase 4: ML-based predictive analytics and recommendations."""
    svc = AnalyticsService(db)
    return await svc.predictive_insights(business_id)


@router.get("/benchmarking/{industry}")
async def competitor_benchmarking(
    industry: str,
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(_require_full_analytics),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Phase 4: Anonymous benchmarking against industry peers.

    industry: retail | food_service | services
    """
    if industry not in ("retail", "food_service", "services"):
        raise HTTPException(400, "industry must be: retail, food_service, or services")
    if not get_settings().ENABLE_ANALYTICS_BENCHMARKING:
        raise HTTPException(
            503,
            "Benchmarking is not available until real anonymized aggregate data is enabled.",
        )
    svc = AnalyticsService(db)
    return await svc.competitor_benchmarking(business_id, industry)


@router.get("/inventory/alerts/predictive-restock")
async def predictive_restock(
    days_ahead: int = Query(7, ge=1, le=30, description="Lookahead window in days"),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Predict items that will need restocking based on sales trends (sales velocity)."""
    svc = AnalyticsService(db)
    return await svc.predictive_restock_alerts(business_id, days_ahead)


@router.get("/inventory/low-stock")
async def low_stock(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Items at or below their low-stock threshold."""
    svc = AnalyticsService(db)
    return await svc.low_stock_items(business_id)
