'use client';

import { useState } from 'react';
import {
  useAdminAgentPayoutSummary,
  useAdminPayoutBalance,
  useAdminPayoutBatches,
  useDisburseLoan,
  usePendingLoanDisbursements,
  useRetryLoanDisbursement,
  useTriggerAgentPayout,
} from '@/hooks/admin/useAdminMoney';

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function paystackMoney(value: unknown, currency?: string) {
  const amount = Number(value ?? 0) / 100;
  const code = (currency || 'GHS').toUpperCase();
  return `${code} ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  const cls = s === 'completed' || s === 'success' || s === 'paid'
    ? 'sf-pill-success'
    : s === 'processing' || s === 'queued' || s === 'approved'
      ? 'sf-pill-brand'
      : s === 'pending' || s === 'confirmed'
        ? 'sf-pill-warn'
        : s === 'failed' || s === 'cancelled'
          ? 'sf-pill-danger'
          : 'sf-pill-neutral';
  return <span className={`sf-pill ${cls}`} style={{ fontSize: 10.5, textTransform: 'capitalize' }}>{status}</span>;
}

export default function AdminPayoutsPage() {
  const [confirmPayout, setConfirmPayout] = useState(false);
  const balance = useAdminPayoutBalance();
  const agentSummary = useAdminAgentPayoutSummary();
  const batches = useAdminPayoutBatches();
  const loans = usePendingLoanDisbursements();
  const triggerAgentPayout = useTriggerAgentPayout();
  const disburseLoan = useDisburseLoan();
  const retryLoan = useRetryLoanDisbursement();

  const paystackBalances = balance.data?.paystack_balances ?? [];
  const batchRows = batches.data?.items ?? [];
  const loanRows = loans.data?.items ?? [];
  const availableAmount = Number(agentSummary.data?.total_available_balance_ghs ?? 0);
  const eligibleAgents = agentSummary.data?.agents_eligible_for_payout ?? 0;
  const isLargeBatch = availableAmount >= 1000 || eligibleAgents >= 100;
  const runAgentPayout = () => {
    triggerAgentPayout.mutate(undefined, { onSuccess: () => setConfirmPayout(false) });
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin</div>
          <div className="sf-display" style={{ fontSize: 22, fontWeight: 650, color: 'var(--ink)' }}>Payout center</div>
        </div>
        <button
          onClick={() => setConfirmPayout(true)}
          disabled={triggerAgentPayout.isPending || eligibleAgents === 0}
          style={{ padding: '9px 14px', borderRadius: 9, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: triggerAgentPayout.isPending ? 0.6 : 1 }}
        >
          {triggerAgentPayout.isPending ? 'Queueing...' : 'Review agent payout'}
        </button>
      </div>

      {confirmPayout && (
        <div style={{ marginBottom: 18, background: isLargeBatch ? 'color-mix(in srgb, var(--gold-2) 12%, transparent)' : 'var(--sf-surface)', border: `1px solid ${isLargeBatch ? 'color-mix(in srgb, var(--gold-2) 36%, transparent)' : 'var(--sf-line)'}`, borderRadius: 14, padding: 16, display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              {isLargeBatch ? 'Large payout batch approval' : 'Confirm agent payout batch'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
              This will queue a Paystack bulk transfer for {eligibleAgents} eligible agents with {money(availableAmount)} available.
              {isLargeBatch ? ' Review treasury balance and OTP requirements before continuing.' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmPayout(false)} style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid var(--sf-line)', background: 'var(--sf-surface)', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
            <button onClick={runAgentPayout} disabled={triggerAgentPayout.isPending || eligibleAgents === 0} style={{ padding: '8px 11px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Queue payout
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['Paystack balance', paystackBalances.length ? paystackBalances.map((b) => paystackMoney(b.balance, b.currency)).join(' / ') : '—'],
          ['Payout liability', money(balance.data?.pending_payout_liability_ghs)],
          ['Agent pending', money(agentSummary.data?.total_pending_balance_ghs)],
          ['Agent available', money(agentSummary.data?.total_available_balance_ghs)],
          ['Eligible agents', `${agentSummary.data?.agents_eligible_for_payout ?? 0}`],
          ['Total paid out', money(agentSummary.data?.total_paid_out_ghs)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 14, minHeight: 86 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div className="sf-display sf-num" style={{ fontSize: 17, fontWeight: 650, marginTop: 6, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 16 }}>
        <section style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sf-line)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Agent payout batches</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{batches.data?.total ?? batchRows.length} batches tracked</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '108px 118px 82px 86px 116px 1fr', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--sf-line)', fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <div>Status</div><div>Amount</div><div>Agents</div><div>Transfers</div><div>Created</div><div>Reference</div>
          </div>

          {batchRows.length === 0 ? (
            <div style={{ padding: 22, color: 'var(--ink-3)', fontSize: 13 }}>No payout batches found.</div>
          ) : batchRows.map((batch) => (
            <div key={batch.id} style={{ display: 'grid', gridTemplateColumns: '108px 118px 82px 86px 116px 1fr', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sf-line)', alignItems: 'center', fontSize: 13 }}>
              {statusPill(batch.status)}
              <span className="sf-num" style={{ fontWeight: 700 }}>{money(batch.total_amount_ghs)}</span>
              <span style={{ color: 'var(--ink-3)' }}>{batch.agent_count}</span>
              <span style={{ color: 'var(--ink-3)' }}>{batch.transfer_count}</span>
              <span style={{ color: 'var(--ink-3)' }}>{shortDate(batch.created_at)}</span>
              <span style={{ color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{batch.paystack_batch_ref ?? batch.id}</span>
            </div>
          ))}
        </section>

        <section style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sf-line)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Loan disbursement queue</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{loans.data?.total ?? loanRows.length} loans ready or retryable</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px 92px 92px 128px', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--sf-line)', fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <div>Loan</div><div>Amount</div><div>Status</div><div>Confirmed</div><div>Actions</div>
          </div>

          {loanRows.length === 0 ? (
            <div style={{ padding: 22, color: 'var(--ink-3)', fontSize: 13 }}>No pending loan disbursements.</div>
          ) : loanRows.map((loan) => {
            const isRetry = loan.status.toLowerCase() === 'failed';
            const isBusy = disburseLoan.isPending || retryLoan.isPending;
            return (
              <div key={loan.loan_id} style={{ display: 'grid', gridTemplateColumns: '1fr 112px 92px 92px 128px', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sf-line)', alignItems: 'center', fontSize: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--ink)', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loan.loan_id}</div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loan.disbursement_phone ?? loan.business_id}</div>
                </div>
                <span className="sf-num" style={{ fontWeight: 700 }}>{money(loan.amount_approved_ghs)}</span>
                {statusPill(loan.status)}
                <span style={{ color: 'var(--ink-3)' }}>{shortDate(loan.confirmed_at)}</span>
                <button
                  onClick={() => (isRetry ? retryLoan.mutate(loan.loan_id) : disburseLoan.mutate(loan.loan_id))}
                  disabled={isBusy}
                  style={{ padding: '7px 9px', borderRadius: 7, border: isRetry ? '1px solid var(--sf-line)' : 'none', background: isRetry ? 'var(--sf-surface)' : 'var(--brand)', color: isRetry ? 'var(--brand)' : '#fff', fontSize: 11, fontWeight: 700, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.55 : 1 }}
                >
                  {isRetry ? 'Retry' : 'Disburse'}
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
