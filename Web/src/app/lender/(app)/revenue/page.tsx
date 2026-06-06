'use client';

import { useState } from 'react';
import { useLenderProfile, useLenderRevenue, useLenderRevenueSummary, exportRevenue } from '@/hooks/lender/useLenderData';

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusPill(status: string) {
  const cls = status === 'paid'
    ? 'sf-pill-success'
    : status === 'earned'
      ? 'sf-pill-brand'
      : status === 'reversed'
        ? 'sf-pill-danger'
        : 'sf-pill-neutral';
  return <span className={`sf-pill ${cls}`} style={{ fontSize: 10.5, textTransform: 'capitalize' }}>{status}</span>;
}

export default function LenderRevenuePage() {
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const profile = useLenderProfile();
  const revenue = useLenderRevenue(status || undefined);
  const summary = useLenderRevenueSummary();
  const rows = revenue.data?.items ?? [];

  async function handleExport() {
    setExporting(true);
    try {
      await exportRevenue();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)', display: 'flex', alignItems: 'center', background: 'var(--sf-surface)', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {profile.data?.name ?? 'Lender'} · Revenue
          </div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Revenue splits</div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 34, borderRadius: 9, border: '1px solid var(--sf-line-2)',
            background: 'var(--sf-surface)', color: 'var(--ink)',
            fontSize: 12.5, fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer',
            padding: '0 14px', marginRight: 10,
            opacity: exporting ? 0.6 : 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        <span className={`sf-pill ${profile.data?.settlement_ready ? 'sf-pill-success' : 'sf-pill-warn'}`}>
          {profile.data?.settlement_ready ? 'Split ready' : 'Split setup pending'}
        </span>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          {[
            ['Earned fees', money(summary.data?.totals.earned_amount), 'Awaiting platform reconciliation'],
            ['Reconciled fees', money(summary.data?.totals.paid_amount), 'Marked paid by SMEFlow ops'],
            ['Principal tracked', money(summary.data?.totals.principal_amount), 'Loans producing revenue rows'],
            ['Revenue rows', `${summary.data?.totals.count ?? 0}`, 'Disbursement and repayment events'],
          ].map(([label, value, sub]) => (
            <div key={label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div className="sf-display sf-num" style={{ fontSize: 22, fontWeight: 650, marginTop: 6, color: 'var(--ink)' }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--sf-line)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Revenue ledger</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{revenue.data?.total ?? rows.length} rows</div>
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '7px 9px', background: 'var(--sf-surface)', color: 'var(--ink)', fontSize: 12 }}>
              <option value="">All statuses</option>
              <option value="earned">Earned</option>
              <option value="paid">Paid</option>
              <option value="reversed">Reversed</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 128px 96px 112px 110px', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--sf-line)', fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <div>Loan</div><div>Business ref</div><div>Principal</div><div>Rate</div><div>Fee</div><div>Status</div>
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: 38, color: 'var(--ink-3)', fontSize: 13, textAlign: 'center' }}>
              No revenue rows yet.
            </div>
          ) : rows.map((row, i, a) => (
            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 128px 96px 112px 110px', gap: 10, padding: '12px 16px', borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none', alignItems: 'center', fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.loan_request_id}</div>
                <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2 }}>{shortDate(row.earned_at)}</div>
              </div>
              <span className="sf-mono" style={{ fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                …{row.business_ref?.slice(-12) ?? '—'}
              </span>
              <span className="sf-num" style={{ fontWeight: 700 }}>{money(row.principal_amount)}</span>
              <span className="sf-num" style={{ color: 'var(--ink-3)' }}>{row.fee_rate_percent}%</span>
              <span className="sf-num" style={{ fontWeight: 700 }}>{money(row.fee_amount)}</span>
              {statusPill(row.status)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
