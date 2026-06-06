/**
 * GRA-formatted VAT Return PDF generator.
 * Uses expo-print to convert an HTML template to PDF, then expo-sharing to share it.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export interface TaxPdfData {
  // Business info
  businessName: string;
  businessType?: string | null;
  businessTin?: string | null;
  businessAddress?: string | null;

  // Period
  periodLabel: string; // e.g. "May 2026"
  periodStart: string; // e.g. "2026-05-01"
  periodEnd: string;   // e.g. "2026-05-31"
  dueDate?: string | null;

  // Tax figures
  vatOutput: number;
  vatInput: number;
  vatPayable: number;
  nhil: number;
  getfund: number;
  covidLevy: number;
  totalTax: number;

  // Filing metadata
  status: string;
  graRef?: string | null;
  submittedAt?: string | null;
  generatedAt: string;
}

function ghs(amount: number): string {
  return `GH₵ ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft — Pending Submission',
    exported: 'Exported — Awaiting Manual GRA Submission',
    submitted: 'Submitted to GRA',
    accepted: 'Accepted by GRA',
    rejected: 'Rejected by GRA',
    failed: 'Submission Failed',
  };
  return map[status] ?? status;
}

function buildHtml(d: TaxPdfData): string {
  const isOfficiallyFiled = d.status === 'submitted' || d.status === 'accepted';
  const isDryRun = (d.graRef ?? '').startsWith('DRY-RUN-');
  const statusBg = isOfficiallyFiled ? '#e6f4ea' : isDryRun ? '#fff8e1' : '#f3f4f6';
  const statusColor = isOfficiallyFiled ? '#1e6b3c' : isDryRun ? '#92650a' : '#374151';
  const typeLabel = (d.businessType ?? 'Business')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    color: #1a1a1a;
    background: #fff;
    padding: 28px 32px;
  }

  /* ── GRA Header ─────────────────────────────────────────── */
  .gra-header {
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 3px solid #006400;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .gra-badge {
    width: 52px; height: 52px;
    border-radius: 50%;
    background: #006400;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .gra-badge span {
    color: #fff; font-size: 14pt; font-weight: bold; font-family: serif;
  }
  .gra-titles { flex: 1; }
  .gra-org {
    font-size: 14pt; font-weight: bold; color: #006400;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .gra-form-title {
    font-size: 11.5pt; font-weight: bold; color: #1a1a1a; margin-top: 2px;
  }
  .gra-subtitle { font-size: 9pt; color: #555; margin-top: 2px; }

  /* ── Period banner ──────────────────────────────────────── */
  .period-banner {
    background: #006400;
    color: #fff;
    padding: 8px 14px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
  }
  .period-banner .period { font-size: 12pt; font-weight: bold; }
  .period-banner .due { font-size: 9.5pt; opacity: 0.88; }

  /* ── Sections ───────────────────────────────────────────── */
  .section {
    border: 1px solid #d1d5db;
    border-radius: 6px;
    margin-bottom: 14px;
    overflow: hidden;
  }
  .section-title {
    background: #f3f4f6;
    padding: 7px 12px;
    font-size: 9pt;
    font-weight: bold;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #374151;
    border-bottom: 1px solid #d1d5db;
  }
  .section-body { padding: 10px 12px; }

  /* ── Two-column info grid ───────────────────────────────── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
  }
  .info-row { display: flex; flex-direction: column; }
  .info-label { font-size: 8pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-value { font-size: 10.5pt; color: #1a1a1a; font-weight: bold; margin-top: 1px; }

  /* ── Tax table ──────────────────────────────────────────── */
  .tax-table { width: 100%; border-collapse: collapse; }
  .tax-table tr { border-bottom: 1px solid #e5e7eb; }
  .tax-table tr:last-child { border-bottom: none; }
  .tax-table td { padding: 6px 4px; font-size: 10.5pt; }
  .tax-table .label { color: #374151; }
  .tax-table .rate  { color: #6b7280; font-size: 9pt; width: 60px; text-align: right; }
  .tax-table .amount { text-align: right; font-family: 'Courier New', monospace; font-size: 10.5pt; color: #1a1a1a; }
  .tax-table .amount.deduction { color: #1e6b3c; }
  .tax-table .divider td { padding: 0; border-bottom: 2px solid #006400; }
  .tax-table .subtotal td { font-weight: bold; background: #f9fafb; padding: 7px 4px; }
  .tax-table .subtotal .amount { color: #006400; }

  /* ── Total ──────────────────────────────────────────────── */
  .total-box {
    background: #006400;
    color: #fff;
    padding: 12px 14px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .total-box .total-label { font-size: 11pt; font-weight: bold; letter-spacing: 0.3px; }
  .total-box .total-amount { font-size: 16pt; font-weight: bold; font-family: 'Courier New', monospace; }

  /* ── Status badge ───────────────────────────────────────── */
  .status-box {
    background: ${statusBg};
    border: 1px solid ${statusColor}44;
    border-radius: 6px;
    padding: 9px 12px;
    margin-bottom: 14px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .status-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: ${statusColor};
    margin-top: 3px; flex-shrink: 0;
  }
  .status-text { font-size: 10pt; color: ${statusColor}; font-weight: bold; }
  .status-sub  { font-size: 8.5pt; color: #555; margin-top: 2px; }

  /* ── Footer ─────────────────────────────────────────────── */
  .footer {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .footer-left { font-size: 8.5pt; color: #6b7280; line-height: 1.6; }
  .footer-right { text-align: right; font-size: 8.5pt; color: #6b7280; }
  .footer-brand { font-size: 10pt; font-weight: bold; color: #006400; }

  /* ── Note box ───────────────────────────────────────────── */
  .note-box {
    background: #fffbeb;
    border-left: 3px solid #d97706;
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    margin-bottom: 14px;
    font-size: 9pt;
    color: #78350f;
    line-height: 1.5;
  }
</style>
</head>
<body>

<!-- ══ GRA Header ══ -->
<div class="gra-header">
  <div class="gra-badge"><span>GRA</span></div>
  <div class="gra-titles">
    <div class="gra-org">Ghana Revenue Authority</div>
    <div class="gra-form-title">Value Added Tax (VAT) Return</div>
    <div class="gra-subtitle">Standard Rate — VAT / NHIL / GETFund / COVID-19 Levy</div>
  </div>
</div>

<!-- ══ Period Banner ══ -->
<div class="period-banner">
  <div class="period">Period: ${d.periodLabel}</div>
  <div class="due">Filing Due: ${formatDate(d.dueDate)}</div>
</div>

<!-- ══ Taxpayer Information ══ -->
<div class="section">
  <div class="section-title">Taxpayer Information</div>
  <div class="section-body">
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Business / Trader Name</span>
        <span class="info-value">${d.businessName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Taxpayer Identification Number (TIN)</span>
        <span class="info-value">${d.businessTin ?? 'Not Provided'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Business Type</span>
        <span class="info-value">${typeLabel}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Business Address</span>
        <span class="info-value">${d.businessAddress ?? 'Not Provided'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Return Period</span>
        <span class="info-value">${formatDate(d.periodStart)} – ${formatDate(d.periodEnd)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Return Type</span>
        <span class="info-value">Monthly VAT Return</span>
      </div>
    </div>
  </div>
</div>

<!-- ══ VAT Computation ══ -->
<div class="section">
  <div class="section-title">Part A — VAT Computation</div>
  <div class="section-body">
    <table class="tax-table">
      <tr>
        <td class="label">1. Output Tax (VAT collected on taxable sales)</td>
        <td class="rate">15%</td>
        <td class="amount">${ghs(d.vatOutput)}</td>
      </tr>
      <tr>
        <td class="label">2. Input Tax Credit (VAT paid on purchases)</td>
        <td class="rate"></td>
        <td class="amount deduction">(${ghs(d.vatInput)})</td>
      </tr>
      <tr class="divider"><td colspan="3"></td></tr>
      <tr class="subtotal">
        <td class="label">3. Net VAT Payable (Line 1 − Line 2)</td>
        <td class="rate"></td>
        <td class="amount">${ghs(d.vatPayable)}</td>
      </tr>
    </table>
  </div>
</div>

<!-- ══ Composite Tax Levies ══ -->
<div class="section">
  <div class="section-title">Part B — Composite Tax Levies (on taxable sales)</div>
  <div class="section-body">
    <table class="tax-table">
      <tr>
        <td class="label">4. National Health Insurance Levy (NHIL)</td>
        <td class="rate">2.5%</td>
        <td class="amount">${ghs(d.nhil)}</td>
      </tr>
      <tr>
        <td class="label">5. Ghana Education Trust Fund Levy (GETFund)</td>
        <td class="rate">2.5%</td>
        <td class="amount">${ghs(d.getfund)}</td>
      </tr>
      <tr>
        <td class="label">6. COVID-19 Health Recovery Levy</td>
        <td class="rate">1%</td>
        <td class="amount">${ghs(d.covidLevy)}</td>
      </tr>
    </table>
  </div>
</div>

<!-- ══ Total ══ -->
<div class="total-box">
  <div class="total-label">Total Tax Payable to GRA<br/><span style="font-size:9pt;font-weight:normal;opacity:0.82">(Lines 3 + 4 + 5 + 6)</span></div>
  <div class="total-amount">${ghs(d.totalTax)}</div>
</div>

<!-- ══ Filing Status ══ -->
${!isOfficiallyFiled ? `<div class="note-box">
  ⚠ This return has not been officially submitted to GRA. To file, log in to GRA e-Services at <strong>eTax.gra.gov.gh</strong>, upload this return, or contact your GRA district office.
</div>` : ''}

<div class="section">
  <div class="section-title">Filing Information</div>
  <div class="section-body">
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Filing Status</span>
        <span class="info-value">${statusLabel(d.status)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">GRA Reference Number</span>
        <span class="info-value">${d.graRef ? (d.graRef.startsWith('DRY-RUN-') ? '— (Offline export)' : d.graRef) : '— (Not yet assigned)'}</span>
      </div>
      ${d.submittedAt ? `<div class="info-row">
        <span class="info-label">Submission Date</span>
        <span class="info-value">${formatDate(d.submittedAt)}</span>
      </div>` : ''}
      <div class="info-row">
        <span class="info-label">Document Generated</span>
        <span class="info-value">${d.generatedAt}</span>
      </div>
    </div>
  </div>
</div>

<!-- ══ Footer ══ -->
<div class="footer">
  <div class="footer-left">
    <div class="footer-brand">SMEflow</div>
    This return was auto-prepared by SMEflow from your recorded sales,<br/>
    invoices, and input VAT. Review all figures before official submission.
  </div>
  <div class="footer-right">
    GRA e-Services: <strong>eTax.gra.gov.gh</strong><br/>
    GRA Helpline: <strong>0800-900-110</strong><br/>
    Document ref: ${d.graRef ?? d.periodStart}
  </div>
</div>

</body>
</html>`;
}

export async function generateAndShareTaxPDF(data: TaxPdfData): Promise<void> {
  const html = buildHtml(data);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `VAT Return — ${data.periodLabel}`,
      UTI: 'com.adobe.pdf',
    });
  } else {
    await Print.printAsync({ uri });
  }
}
