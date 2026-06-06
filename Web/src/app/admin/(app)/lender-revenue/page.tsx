'use client';

import { useMemo, useState } from 'react';
import { useAdminLenders } from '@/hooks/admin/useAdminPeople';
import {
  type AdminLenderRevenue,
  useAdminLenderRevenue,
  useAdminLenderRevenueSummary,
  useMarkLenderRevenuePaid,
  useSetupLenderSubaccount,
} from '@/hooks/admin/useAdminMoney';

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

function lenderName(lenders: ReturnType<typeof useAdminLenders>['data'], lenderId: string) {
  return lenders?.items.find((l) => l.lender_id === lenderId)?.name ?? lenderId;
}

function RevenueRow({
  row,
  lenderLabel,
  onSelect,
  onMarkPaid,
  isMarking,
}: {
  row: AdminLenderRevenue;
  lenderLabel: string;
  onSelect: () => void;
  onMarkPaid: () => void;
  isMarking: boolean;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 120px 92px 105px 110px 130px', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sf-line)', alignItems: 'center', fontSize: 13 }}>
      <button onClick={onSelect} style={{ all: 'unset', cursor: 'pointer', minWidth: 0 }}>
        <div style={{ color: 'var(--ink)', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lenderLabel}</div>
        <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.loan_request_id}</div>
      </button>
      <span style={{ color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.business_id}</span>
      <span className="sf-num" style={{ fontWeight: 700 }}>{money(row.principal_amount)}</span>
      <span className="sf-num" style={{ color: 'var(--ink-3)' }}>{row.fee_rate_percent}%</span>
      <span className="sf-num" style={{ fontWeight: 700 }}>{money(row.fee_amount)}</span>
      {statusPill(row.status)}
      <button
        onClick={onMarkPaid}
        disabled={row.status === 'paid' || isMarking}
        style={{ padding: '7px 9px', borderRadius: 7, border: 'none', background: row.status === 'paid' ? 'var(--sf-sunken)' : 'var(--brand)', color: row.status === 'paid' ? 'var(--ink-4)' : '#fff', fontSize: 11, fontWeight: 700, cursor: row.status === 'paid' || isMarking ? 'not-allowed' : 'pointer' }}
      >
        {row.status === 'paid' ? 'Reconciled' : 'Mark paid'}
      </button>
    </div>
  );
}

export default function AdminLenderRevenuePage() {
  const [status, setStatus] = useState('');
  const [selectedLender, setSelectedLender] = useState('');
  const [selectedRevenue, setSelectedRevenue] = useState<AdminLenderRevenue | null>(null);
  const [setupLender, setSetupLender] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [platformFee, setPlatformFee] = useState('10');

  const lenders = useAdminLenders();
  const revenue = useAdminLenderRevenue(status || undefined, selectedLender || undefined);
  const summary = useAdminLenderRevenueSummary(selectedLender || undefined);
  const markPaid = useMarkLenderRevenuePaid();
  const setup = useSetupLenderSubaccount();

  const rows = revenue.data?.items ?? [];
  const lenderRows = lenders.data?.items ?? [];
  const selectedSetupLender = lenderRows.find((l) => l.lender_id === setupLender);
  const splitReady = useMemo(() => lenderRows.filter((l) => l.settlement_ready).length, [lenderRows]);

  function submitSetup() {
    if (!setupLender || !bankCode || !accountNumber || !platformFee) return;
    setup.mutate({
      lenderId: setupLender,
      settlement_bank_code: bankCode,
      settlement_account_number: accountNumber,
      platform_fee_percent: platformFee,
    });
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin</div>
          <div className="sf-display" style={{ fontSize: 22, fontWeight: 650, color: 'var(--ink)' }}>Lender revenue</div>
        </div>
        <span className={splitReady === lenderRows.length && lenderRows.length > 0 ? 'sf-pill sf-pill-success' : 'sf-pill sf-pill-warn'}>
          {splitReady}/{lenderRows.length} split-ready
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['Earned fees', money(summary.data?.totals.earned_amount)],
          ['Reconciled fees', money(summary.data?.totals.paid_amount)],
          ['Reversed fees', money(summary.data?.totals.reversed_amount)],
          ['Revenue rows', `${revenue.data?.total ?? rows.length}`],
        ].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div className="sf-display sf-num" style={{ fontSize: 20, fontWeight: 650, marginTop: 6, color: 'var(--ink)' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) 360px', gap: 16 }}>
        <section style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--sf-line)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Revenue ledger</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Loan-originated platform fees by lender</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={selectedLender} onChange={(e) => setSelectedLender(e.target.value)} style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '7px 9px', background: 'var(--sf-surface)', color: 'var(--ink)', fontSize: 12 }}>
                <option value="">All lenders</option>
                {lenderRows.map((lender) => <option key={lender.lender_id} value={lender.lender_id}>{lender.name}</option>)}
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '7px 9px', background: 'var(--sf-surface)', color: 'var(--ink)', fontSize: 12 }}>
                <option value="">All statuses</option>
                <option value="earned">Earned</option>
                <option value="paid">Paid</option>
                <option value="reversed">Reversed</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 120px 92px 105px 110px 130px', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--sf-line)', fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <div>Lender / Loan</div><div>Business</div><div>Principal</div><div>Fee rate</div><div>Fee</div><div>Status</div><div>Action</div>
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: 22, color: 'var(--ink-3)', fontSize: 13 }}>No lender revenue rows found.</div>
          ) : rows.map((row) => (
            <RevenueRow
              key={row.id}
              row={row}
              lenderLabel={lenderName(lenders.data, row.lender_id)}
              onSelect={() => setSelectedRevenue(row)}
              onMarkPaid={() => markPaid.mutate(row.id)}
              isMarking={markPaid.isPending}
            />
          ))}
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Split setup</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45, marginTop: 5 }}>Provision Paystack subaccount and split code for repayment revenue separation.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 14 }}>
              <select value={setupLender} onChange={(e) => setSetupLender(e.target.value)} style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '9px', background: 'var(--sf-surface)', color: 'var(--ink)', fontSize: 12 }}>
                <option value="">Select lender</option>
                {lenderRows.map((lender) => <option key={lender.lender_id} value={lender.lender_id}>{lender.name}</option>)}
              </select>
              <input value={bankCode} onChange={(e) => setBankCode(e.target.value)} placeholder="Bank code" style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '9px', fontSize: 12 }} />
              <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Settlement account number" style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '9px', fontSize: 12 }} />
              <input value={platformFee} onChange={(e) => setPlatformFee(e.target.value)} placeholder="Platform fee percent" style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '9px', fontSize: 12 }} />
              <button onClick={submitSetup} disabled={!setupLender || !bankCode || !accountNumber || !platformFee || setup.isPending} style={{ padding: '9px 10px', borderRadius: 8, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: setupLender && bankCode && accountNumber && platformFee ? 'pointer' : 'not-allowed', opacity: setupLender && bankCode && accountNumber && platformFee ? 1 : 0.5 }}>
                {setup.isPending ? 'Provisioning...' : selectedSetupLender?.settlement_ready ? 'Refresh split setup' : 'Provision split'}
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Selected revenue</div>
            {!selectedRevenue ? (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-3)' }}>Select a row to inspect provider ref, dates, and reconciliation status.</div>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {[
                  ['Lender', lenderName(lenders.data, selectedRevenue.lender_id)],
                  ['Loan', selectedRevenue.loan_request_id],
                  ['Provider ref', selectedRevenue.provider_ref ?? '—'],
                  ['Earned', shortDate(selectedRevenue.earned_at)],
                  ['Paid', shortDate(selectedRevenue.paid_at)],
                  ['Fee', money(selectedRevenue.fee_amount)],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--sf-line)', paddingBottom: 7 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{label}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 650, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
