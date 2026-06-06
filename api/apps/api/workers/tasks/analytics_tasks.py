"""Celery tasks for analytics exports."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import gettempdir
from typing import Any
from uuid import UUID

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
_EXPORT_DIR = Path(gettempdir()) / "smeflow_exports"


@celery.task(
    bind=True, max_retries=2, name="apps.api.workers.tasks.analytics_tasks.export_analytics_report"
)
def export_analytics_report(
    self,
    business_id: str,
    report: str,
    export_format: str,
    period: str,
    group_by: str,
    limit: int,
) -> dict:
    """Build a premium analytics export and return the generated file path."""
    import asyncio

    async def _run() -> dict:
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.analytics.service import AnalyticsService

        from_date, to_date = _period_window(period)
        async with AsyncSessionLocal() as db:
            svc = AnalyticsService(db)
            rows: list[dict[str, Any]]
            title: str
            if report == "revenue":
                rows = await svc.revenue_by_day(UUID(business_id), from_date, to_date)
                title = f"Revenue {from_date} to {to_date}"
            elif report == "top_items":
                rows = await svc.top_items(UUID(business_id), from_date, to_date, limit)
                title = f"Top Items {from_date} to {to_date}"
            elif report == "profit_loss":
                rows = [await svc.pnl_summary(UUID(business_id), from_date, to_date)]
                title = f"Profit & Loss {from_date} to {to_date}"
            elif report == "cash_flow":
                rows = [await svc.cash_flow(UUID(business_id), from_date, to_date)]
                title = f"Cash Flow {from_date} to {to_date}"
            else:
                raise ValueError(f"Unsupported analytics report: {report}")

        _EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        suffix = "xlsx" if export_format == "xlsx" else "pdf"
        path = _EXPORT_DIR / f"analytics-{business_id}-{report}-{self.request.id}.{suffix}"
        if export_format == "xlsx":
            _write_xlsx(path, title, rows)
        elif export_format == "pdf":
            _write_pdf(path, title, rows)
        elif export_format == "csv":
            _write_csv(path, rows)
        else:
            raise ValueError(f"Unsupported export format: {export_format}")

        logger.info(
            "analytics.export.generated",
            business_id=business_id,
            report=report,
            format=export_format,
            path=str(path),
        )
        return {
            "business_id": business_id,
            "report": report,
            "format": export_format,
            "from_date": from_date,
            "to_date": to_date,
            "file_path": str(path),
        }

    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error("analytics.export.failed", business_id=business_id, error=str(exc))
        raise self.retry(exc=exc) from exc


def _period_window(period: str) -> tuple[str, str]:
    today = date.today()
    days = _PERIOD_DAYS.get(period, 30)
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


def _stringify(value: Any) -> str:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return "" if value is None else str(value)


def _headers(rows: list[dict[str, Any]]) -> list[str]:
    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys:
                keys.append(key)
    return keys or ["message"]


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    """Write rows to a UTF-8 CSV file with BOM for Excel compatibility."""
    import csv
    import io

    headers = _headers(rows)
    output = io.StringIO()
    output.write("﻿")  # BOM
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    for row in rows or [{}]:
        writer.writerow({h: _stringify(row.get(h)) for h in headers})
    path.write_text(output.getvalue(), encoding="utf-8-sig")


def _write_pdf(path: Path, title: str, rows: list[dict[str, Any]]) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    pdf = canvas.Canvas(str(path), pagesize=A4)
    _width, height = A4
    y = height - 72
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(72, y, title)
    y -= 28
    pdf.setFont("Helvetica", 9)

    for row in rows or [{"message": "No data"}]:
        for key, value in row.items():
            pdf.drawString(72, y, f"{key}: {_stringify(value)}")
            y -= 14
            if y < 72:
                pdf.showPage()
                pdf.setFont("Helvetica", 9)
                y = height - 72
        y -= 10

    pdf.save()


def _write_xlsx(path: Path, title: str, rows: list[dict[str, Any]]) -> None:
    """Write a small standards-compliant XLSX file using only stdlib zipfile."""
    import html
    import zipfile

    headers = _headers(rows)
    body_rows = rows or [{"message": "No data"}]
    table: list[list[str]] = [[title], [], headers]
    table.extend([[_stringify(row.get(header)) for header in headers] for row in body_rows])

    sheet_rows = []
    for row_index, values in enumerate(table, start=1):
        cells = []
        for col_index, value in enumerate(values, start=1):
            ref = f"{_column_name(col_index)}{row_index}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{html.escape(value)}</t></is></c>')
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(sheet_rows)}</sheetData></worksheet>"
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Analytics" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )
    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", rels_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def _column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name
