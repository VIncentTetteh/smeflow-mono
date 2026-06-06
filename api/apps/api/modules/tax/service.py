"""Tax service — GRA return generation and filing."""

import calendar
from datetime import date, datetime, time, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.modules.tax.models import TaxReturn

logger = structlog.get_logger()
settings = get_settings()


class TaxService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def generate_monthly_return(
        self, business_id: UUID, year: int, month: int, force_refresh: bool = False
    ) -> TaxReturn:
        """Aggregate invoices for the period and build a GRA-ready return draft.

        When force_refresh=True and a non-filed draft exists, recalculates all figures
        from the current sales/invoice data so the user's latest records are reflected.
        """
        period_start = date(year, month, 1)
        period_end = date(year, month, calendar.monthrange(year, month)[1])

        existing = await self.db.execute(
            select(TaxReturn).where(
                TaxReturn.business_id == business_id,
                TaxReturn.period_start == period_start,
            )
        )
        existing_return = existing.scalar_one_or_none()

        # If already submitted/accepted, never touch it
        if existing_return and existing_return.status in ("submitted", "accepted"):
            logger.info("tax.return.already_filed", business_id=str(business_id))
            return existing_return

        # Return early only if not forcing a refresh
        if existing_return and not force_refresh:
            return existing_return

        # ── Calculate fresh figures ──────────────────────────────────────────
        from apps.api.modules.invoicing.models import Invoice
        from apps.api.modules.tax.input_vat import InputVATRecord

        start_at = datetime.combine(period_start, time.min)
        end_at = datetime.combine(period_end, time.max)
        agg = await self.db.execute(
            select(
                func.coalesce(func.sum(Invoice.vat_amount), 0).label("vat"),
                func.coalesce(func.sum(Invoice.nhil_amount), 0).label("nhil"),
                func.coalesce(func.sum(Invoice.getfund_amount), 0).label("getfund"),
                func.coalesce(func.sum(Invoice.covid_levy), 0).label("covid"),
            ).where(
                Invoice.business_id == business_id,
                Invoice.status != "cancelled",
                Invoice.issued_at >= start_at,
                Invoice.issued_at <= end_at,
            )
        )
        row = agg.one()
        vat_output = Decimal(str(row.vat))
        nhil = Decimal(str(row.nhil))
        getfund = Decimal(str(row.getfund))
        covid = Decimal(str(row.covid))

        input_agg = await self.db.execute(
            select(func.coalesce(func.sum(InputVATRecord.vat_amount), 0).label("input_vat")).where(
                InputVATRecord.business_id == business_id,
                InputVATRecord.purchase_date >= period_start,
                InputVATRecord.purchase_date <= period_end,
            )
        )
        input_vat = Decimal(str(input_agg.one().input_vat))
        vat_payable = max(vat_output - input_vat, Decimal("0"))
        total_tax = vat_payable + nhil + getfund + covid
        payload = self._build_gra_payload(
            business_id, year, month, vat_output, input_vat, total_tax
        )

        if existing_return:
            # Update the existing draft in-place with fresh figures
            existing_return.vat_output = vat_output
            existing_return.vat_input = input_vat
            existing_return.vat_payable = vat_payable
            existing_return.nhil_amount = nhil
            existing_return.getfund_amount = getfund
            existing_return.covid_levy = covid
            existing_return.total_tax = total_tax
            existing_return.payload_json = payload
            existing_return.status = "draft"
            await self.db.flush([existing_return])
            logger.info(
                "tax.return.refreshed",
                business_id=str(business_id),
                period=f"{year}-{month:02d}",
                total_tax=str(total_tax),
            )
            return existing_return

        tax_return = TaxReturn(
            business_id=business_id,
            period_type="monthly",
            period_start=period_start,
            period_end=period_end,
            vat_output=vat_output,
            vat_input=input_vat,
            vat_payable=vat_payable,
            nhil_amount=nhil,
            getfund_amount=getfund,
            covid_levy=covid,
            total_tax=total_tax,
            payload_json=payload,
        )
        self.db.add(tax_return)
        await self.db.flush([tax_return])
        logger.info(
            "tax.return.generated",
            business_id=str(business_id),
            period=f"{year}-{month:02d}",
            total_tax=str(total_tax),
        )
        return tax_return

    def _build_gra_payload(
        self,
        business_id: UUID,
        year: int,
        month: int,
        vat: Decimal,
        input_vat: Decimal,
        total_tax: Decimal,
    ) -> dict:
        return {
            "taxpayer_id": str(business_id),
            "period": f"{year}-{month:02d}",
            "vat_standard_rate": str(settings.VAT_RATE),
            "output_tax": str(vat),
            "input_tax": str(input_vat),
            "input_vat_source": "purchase_invoices" if input_vat > Decimal("0") else "not_tracked",
            "net_vat_payable": str(vat - input_vat if vat >= input_vat else Decimal("0")),
            "tax_payable": str(total_tax),
            "currency": "GHS",
        }

    async def get_summary(
        self, business_id: UUID, period_type: str, year: int, month: int | None = None
    ) -> dict:
        """Return tax summary for a given period — used by the /tax/summary endpoint."""
        if period_type == "monthly" and month:
            return await self._monthly_summary(business_id, year, month)
        return {
            "period_type": period_type,
            "year": year,
            "message": "Use period_type=monthly&month=N",
        }

    async def _monthly_summary(self, business_id: UUID, year: int, month: int) -> dict:
        """
        Always aggregates figures live from invoices/input-VAT so the summary reflects
        the latest sales without requiring a manual 'Refresh draft' click.
        The stored TaxReturn is used only for filing metadata (status, gra_ref).
        """
        period_start = date(year, month, 1)
        period_end = date(year, month, calendar.monthrange(year, month)[1])

        # ── Load filing metadata from stored TaxReturn (status, gra_ref) ────
        result = await self.db.execute(
            select(TaxReturn).where(
                TaxReturn.business_id == business_id,
                TaxReturn.period_start == period_start,
            )
        )
        tr = result.scalar_one_or_none()
        if not tr:
            tr = await self.generate_monthly_return(business_id, year, month)

        # ── Always aggregate VAT figures live from invoices ──────────────────
        from apps.api.modules.invoicing.models import Invoice
        from apps.api.modules.tax.input_vat import InputVATRecord

        start_at = datetime.combine(period_start, time.min)
        end_at = datetime.combine(period_end, time.max)
        live_agg = await self.db.execute(
            select(
                func.coalesce(func.sum(Invoice.vat_amount), 0).label("vat"),
                func.coalesce(func.sum(Invoice.nhil_amount), 0).label("nhil"),
                func.coalesce(func.sum(Invoice.getfund_amount), 0).label("getfund"),
                func.coalesce(func.sum(Invoice.covid_levy), 0).label("covid"),
                func.coalesce(func.sum(Invoice.subtotal), 0).label("subtotal"),
            ).where(
                Invoice.business_id == business_id,
                Invoice.status.not_in(["cancelled", "voided"]),
                Invoice.issued_at >= start_at,
                Invoice.issued_at <= end_at,
            )
        )
        live = live_agg.one()
        vat_output = Decimal(str(live.vat))
        nhil = Decimal(str(live.nhil))
        getfund = Decimal(str(live.getfund))
        covid = Decimal(str(live.covid))
        monthly_revenue = Decimal(str(live.subtotal))

        input_agg = await self.db.execute(
            select(func.coalesce(func.sum(InputVATRecord.vat_amount), 0).label("input_vat")).where(
                InputVATRecord.business_id == business_id,
                InputVATRecord.purchase_date >= period_start,
                InputVATRecord.purchase_date <= period_end,
            )
        )
        vat_input = Decimal(str(input_agg.one().input_vat))
        vat_payable = max(vat_output - vat_input, Decimal("0"))
        total_tax = vat_payable + nhil + getfund + covid

        # ── PAYE withheld from payroll ────────────────────────────────────────
        from apps.api.modules.payroll.models import PayrollRun

        paye_agg = await self.db.execute(
            select(func.coalesce(func.sum(PayrollRun.total_income_tax), 0).label("paye")).where(
                PayrollRun.business_id == business_id,
                PayrollRun.status.in_(["completed", "disbursed"]),
                PayrollRun.period_start >= period_start,
                PayrollRun.period_start <= period_end,
            )
        )
        paye_withheld = Decimal(str(paye_agg.one().paye))

        # ── Estimated personal income tax ─────────────────────────────────────
        from apps.api.modules.payroll.tax_calculator import calculate_paye

        estimated_taxable = monthly_revenue * Decimal("0.30")
        estimated_income_tax = calculate_paye(estimated_taxable)

        due_year = year + (1 if month == 12 else 0)
        due_month = 1 if month == 12 else month + 1
        due_day = min(30, calendar.monthrange(due_year, due_month)[1])

        return {
            "period": f"{year}-{month:02d}",
            "vat_output": vat_output,
            "vat_input": vat_input,
            "vat_payable": vat_payable,
            "estimated_vat_payable": vat_payable,
            "nhil": nhil,
            "getfund": getfund,
            "covid_levy": covid,
            "total_tax": total_tax,
            "status": tr.status,
            "paye_withheld": paye_withheld,
            "estimated_income_tax": estimated_income_tax,
            "due_date": date(due_year, due_month, due_day),
            "filing_readiness": {
                "has_generated_return": True,
                "has_gra_ref": bool(tr.gra_ref),
                "can_file": tr.status in ("draft", "exported", "failed"),
            },
        }

    async def list_returns(self, business_id: UUID) -> list[TaxReturn]:
        result = await self.db.execute(
            select(TaxReturn)
            .where(TaxReturn.business_id == business_id)
            .order_by(TaxReturn.period_start.desc())
        )
        return list(result.scalars().all())

    async def get_return(self, business_id: UUID, return_id: UUID) -> TaxReturn:
        from apps.api.core.exceptions import NotFoundError

        result = await self.db.execute(
            select(TaxReturn).where(TaxReturn.id == return_id, TaxReturn.business_id == business_id)
        )
        tax_return = result.scalar_one_or_none()
        if not tax_return:
            raise NotFoundError("TaxReturn", str(return_id))
        return tax_return

    async def file_return(self, business_id: UUID, return_id: UUID) -> TaxReturn:
        """
        File a tax return with GRA.

        When ``ENABLE_GRA_DIRECT_FILING`` is True, the return is sent to the GRA
        e-VAT API via the real HTTP client.  The result is persisted to the DB
        regardless of outcome — failed submissions are queued for async retry via
        Celery (see :func:`apps.api.workers.tasks.tax_tasks.retry_failed_gra_filing`).

        When the flag is False (default), the return is exported to a local JSON
        store (same behaviour as before).
        """
        from sqlalchemy import select as _select

        from apps.api.modules.business.models import Business

        tax_return = await self.get_return(business_id, return_id)

        if tax_return.status in ("submitted", "accepted"):
            logger.info("tax.return.already_filed", return_id=str(return_id))
            return tax_return

        if settings.ENABLE_GRA_DIRECT_FILING:
            # Fetch business TIN (stored in Business.gra_tin if available)
            biz_result = await self.db.execute(_select(Business).where(Business.id == business_id))
            business = biz_result.scalar_one_or_none()
            tin = getattr(business, "gra_tin", None)
            if not tin:
                from apps.api.core.exceptions import SMEFlowError

                raise SMEFlowError(
                    "Business GRA TIN is required to file a tax return. Please update your business profile.",
                    code="MISSING_GRA_TIN",
                    status_code=422,
                )
            business_name = business.name if business else str(business_id)

            try:
                from libs.gra_client import GRAClient

                async with GRAClient() as gra:
                    result = await gra.submit_vat_return(
                        tin=tin,
                        business_name=business_name,
                        period_start=tax_return.period_start,
                        period_end=tax_return.period_end,
                        vat_output=tax_return.vat_output,
                        vat_input=tax_return.vat_input or Decimal("0"),
                        nhil=tax_return.nhil_amount,
                        getfund=tax_return.getfund_amount,
                        covid_levy=tax_return.covid_levy,
                        total_tax=tax_return.total_tax,
                    )

                if result.success:
                    tax_return.status = "submitted"
                    tax_return.gra_ref = result.gra_ref
                    tax_return.submitted_at = datetime.now(timezone.utc)
                    logger.info(
                        "tax.return.filed",
                        return_id=str(return_id),
                        gra_ref=result.gra_ref,
                    )
                else:
                    tax_return.status = "rejected"
                    tax_return.payload_json = {
                        **(tax_return.payload_json or {}),
                        "gra_error": result.message,
                        "gra_raw": result.raw,
                    }
                    logger.error(
                        "tax.return.rejected_by_gra",
                        return_id=str(return_id),
                        reason=result.message,
                    )
                    # Enqueue async retry
                    from apps.api.workers.dispatch import enqueue_task
                    from apps.api.workers.tasks.tax_tasks import retry_failed_gra_filing

                    enqueue_task(retry_failed_gra_filing, str(return_id), countdown=300)

            except Exception as exc:
                logger.error(
                    "tax.return.gra_client_error",
                    return_id=str(return_id),
                    error=str(exc),
                )
                tax_return.status = "draft"  # leave for retry
                tax_return.payload_json = {
                    **(tax_return.payload_json or {}),
                    "gra_error": str(exc),
                }
                from apps.api.workers.dispatch import enqueue_task
                from apps.api.workers.tasks.tax_tasks import retry_failed_gra_filing

                enqueue_task(retry_failed_gra_filing, str(return_id), countdown=300)
        else:
            # Offline / export mode — NOT a real GRA submission.
            # Use DRY-RUN- prefix so the mobile shows the correct "simulation only" message.
            tax_return.status = "exported"
            tax_return.gra_ref = f"DRY-RUN-{tax_return.period_start:%Y%m}-{str(tax_return.id)[:8]}"
            tax_return.export_url = f"local://tax-returns/{tax_return.id}.json"
            tax_return.submitted_at = datetime.now(timezone.utc)

        await self.db.flush([tax_return])
        return tax_return

    async def export_return(self, business_id: UUID, return_id: UUID) -> dict:
        tax_return = await self.get_return(business_id, return_id)
        return {
            "id": str(tax_return.id),
            "status": tax_return.status,
            "export_url": tax_return.export_url or f"local://tax-returns/{tax_return.id}.json",
            "payload": tax_return.payload_json or {},
        }

    def calendar(self, year: int, month: int) -> list[dict]:
        period = f"{year}-{month:02d}"
        next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
        entries = [
            {
                "tax_type": "PAYE",
                "period": period,
                "due_date": date(next_year, next_month, 15),
                "description": "Monthly PAYE return due on the 15th of the following month.",
            },
            {
                "tax_type": "VAT",
                "period": period,
                "due_date": self._last_working_day(next_year, next_month),
                "description": "VAT/NHIL/GETFund/COVID Levy return due by the last working day of the following month.",
            },
            {
                "tax_type": "SSNIT",
                "period": period,
                "due_date": date(next_year, next_month, 14),
                "description": "Monthly SSNIT Tier 1 contribution due by 14th of the following month.",
            },
        ]
        # Annual income tax return in April of the following year
        if month == 12:
            entries.append(
                {
                    "tax_type": "INCOME_TAX",
                    "period": str(year),
                    "due_date": date(year + 1, 4, 30),
                    "description": f"Annual income tax return for {year} due 30 April {year + 1}.",
                }
            )
        # Provisional income tax (quarterly) — due March, June, September for current year
        if month in (3, 6, 9):
            quarter = {3: "Q1", 6: "Q2", 9: "Q3"}[month]
            entries.append(
                {
                    "tax_type": "PROVISIONAL_INCOME_TAX",
                    "period": f"{year}-{quarter}",
                    "due_date": date(year, month, 31 if month in (3,) else 30),
                    "description": f"Provisional income tax payment ({quarter} {year}) due end of month.",
                }
            )
        return entries

    def _last_working_day(self, year: int, month: int) -> date:
        day = date(year, month, calendar.monthrange(year, month)[1])
        while day.weekday() >= 5:
            day = date.fromordinal(day.toordinal() - 1)
        return day
