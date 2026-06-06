'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppealItem,
  decideAppeal,
  fetchAppeals,
  fetchDvaPayments,
  fetchLenderRevenue,
  fetchPendingActions,
  fetchProviderReadiness,
  fetchTransactions,
} from '@/lib/adminApi';
import {
  useAdminAgentPayoutSummary,
  useAdminLenderRevenueSummary,
  useAdminPayoutBalance,
  useAdminPayoutBatches,
  useAdminSettlementSummary,
  useAdminSettlements,
  usePendingLoanDisbursements,
} from '@/hooks/admin/useAdminMoney';
import { TotpDialog } from '@/components/admin/TotpDialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type Tab = 'money' | 'transactions' | 'dva' | 'appeals' | 'pending' | 'revenue' | 'readiness';

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function paystackMoney(value: unknown, currency?: string) {
  const amount = Number(value ?? 0) / 100;
  const code = (currency || 'GHS').toUpperCase();
  return `${code} ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function Pill({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const cls = lower.includes('ready') || lower.includes('paid') || lower.includes('success') || lower.includes('approved')
    ? 'sf-pill-success'
    : lower.includes('pending') || lower.includes('earned')
    ? 'sf-pill-warn'
    : lower.includes('blocked') || lower.includes('failed') || lower.includes('reversed')
    ? 'sf-pill-danger'
    : 'sf-pill-neutral';
  return <span className={`sf-pill ${cls}`} style={{ fontSize: 10.5 }}>{value}</span>;
}

export default function AdminOpsPage() {
  const [tab, setTab] = useState<Tab>('money');
  const [page, setPage] = useState(1);
  const [appealAction, setAppealAction] = useState<{ appeal: AppealItem; action: 'approve' } | null>(null);
  const [rejectAppeal, setRejectAppeal] = useState<AppealItem | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [rejectTotp, setRejectTotp] = useState('');
  const qc = useQueryClient();
  const transactions = useQuery({ queryKey: ['admin', 'transactions', page], queryFn: () => fetchTransactions(page), enabled: tab === 'transactions' });
  const dvaPayments = useQuery({ queryKey: ['admin', 'dva-payments', page], queryFn: () => fetchDvaPayments(page), enabled: tab === 'dva' });
  const appeals = useQuery({ queryKey: ['admin', 'appeals'], queryFn: () => fetchAppeals(undefined), enabled: tab === 'appeals' });
  const pending = useQuery({ queryKey: ['admin', 'pending-actions'], queryFn: () => fetchPendingActions(undefined), enabled: tab === 'pending' });
  const revenue = useQuery({ queryKey: ['admin', 'lender-revenue', page], queryFn: () => fetchLenderRevenue(page), enabled: tab === 'revenue' });
  const readiness = useQuery({ queryKey: ['admin', 'provider-readiness'], queryFn: fetchProviderReadiness, enabled: tab === 'readiness' || tab === 'money' });
  const payoutBalance = useAdminPayoutBalance();
  const agentSummary = useAdminAgentPayoutSummary();
  const payoutBatches = useAdminPayoutBatches();
  const pendingLoans = usePendingLoanDisbursements();
  const settlementSummary = useAdminSettlementSummary();
  const failedSettlements = useAdminSettlements('failed');
  const lenderRevenueSummary = useAdminLenderRevenueSummary();
  const appealDecision = useMutation({
    mutationFn: ({ code, appeal, action, reason }: { code?: string; appeal: AppealItem; action: 'approve' | 'reject'; reason?: string }) => {
      return decideAppeal(appeal.id, action, reason, code);
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.action === 'approve' ? 'Appeal approved' : 'Appeal rejected');
      setAppealAction(null);
      setRejectAppeal(null);
      setAppealReason('');
      setRejectTotp('');
      qc.invalidateQueries({ queryKey: ['admin', 'appeals'] });
      qc.invalidateQueries({ queryKey: ['admin', 'businesses'] });
    },
    onError: () => toast.error('Appeal decision failed. Please try again.'),
  });

  const paystackBalances = payoutBalance.data?.paystack_balances ?? [];
  const failedBatchCount = (payoutBatches.data?.items ?? []).filter((b) => ['failed', 'partial_failed'].includes(b.status)).length;
  const failedSettlementCount = failedSettlements.data?.total ?? failedSettlements.data?.items?.length ?? 0;
  const readinessStatus = readiness.data?.status ?? 'not checked';
  const totalOutstanding = Number(payoutBalance.data?.pending_payout_liability_ghs ?? 0)
    + Number(settlementSummary.data?.total_unsettled_liability_ghs ?? 0)
    + Number(lenderRevenueSummary.data?.totals.earned_amount ?? 0);
  const opsAlerts = [
    {
      label: 'Merchant settlement approvals',
      value: `${settlementSummary.data?.pending_approval_count ?? 0}`,
      detail: money(settlementSummary.data?.pending_approval_amount_ghs),
      href: '/admin/settlements',
      tone: (settlementSummary.data?.pending_approval_count ?? 0) > 0 ? 'warn' : 'success',
    },
    {
      label: 'Loan disbursement queue',
      value: `${pendingLoans.data?.total ?? pendingLoans.data?.items?.length ?? 0}`,
      detail: 'Confirmed loans awaiting transfer',
      href: '/admin/payouts',
      tone: (pendingLoans.data?.total ?? 0) > 0 ? 'warn' : 'success',
    },
    {
      label: 'Failed payout batches',
      value: `${failedBatchCount}`,
      detail: 'Agent batches needing review',
      href: '/admin/payouts',
      tone: failedBatchCount > 0 ? 'danger' : 'success',
    },
    {
      label: 'Failed settlements',
      value: `${failedSettlementCount}`,
      detail: 'Merchant transfers needing retry',
      href: '/admin/settlements',
      tone: failedSettlementCount > 0 ? 'danger' : 'success',
    },
  ];

  const setActiveTab = (next: Tab) => {
    setTab(next);
    setPage(1);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Operations</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Ops queues</div>
        </div>
      </div>

      <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--sf-line)', display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--sf-surface)' }}>
        {[
          ['money', 'Money monitor'],
          ['transactions', 'Transactions'],
          ['dva', 'DVA transfers'],
          ['appeals', 'Appeals'],
          ['pending', 'Pending actions'],
          ['revenue', 'Lender revenue'],
          ['readiness', 'Provider readiness'],
        ].map(([id, label]) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setActiveTab(id as Tab)} style={{
              padding: '5px 12px', borderRadius: 999, border: active ? 'none' : '1px solid var(--sf-line)',
              background: active ? 'var(--ink)' : 'var(--sf-surface)',
              color: active ? '#fdf7eb' : 'var(--ink-3)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            }}>
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        {tab === 'money' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
              {[
                ['Paystack balance', paystackBalances.length ? paystackBalances.map((b) => paystackMoney(b.balance, b.currency)).join(' / ') : '—', 'Current platform treasury'],
                ['Outstanding exposure', money(totalOutstanding), 'Payout + settlement + earned lender fees'],
                ['Merchant liability', money(settlementSummary.data?.total_unsettled_liability_ghs), 'Unsettled merchant wallet balance'],
                ['Agent available', money(agentSummary.data?.total_available_balance_ghs), `${agentSummary.data?.agents_eligible_for_payout ?? 0} eligible agents`],
                ['Lender fees earned', money(lenderRevenueSummary.data?.totals.earned_amount), 'Pending reconciliation'],
              ].map(([label, value, sub]) => (
                <div key={label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 14, minHeight: 90 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                  <div className="sf-display sf-num" style={{ fontSize: 18, fontWeight: 650, color: 'var(--ink)', marginTop: 6, overflowWrap: 'anywhere' }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: 16 }}>
              <section style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--sf-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Operational alerts</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>Queues that affect money movement or reconciliation</div>
                  </div>
                  <Pill value={readinessStatus} />
                </div>
                {opsAlerts.map((alert, i, a) => (
                  <a key={alert.label} href={alert.href} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 96px', gap: 12, padding: '13px 16px', borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none', textDecoration: 'none', color: 'inherit', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 650 }}>{alert.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{alert.detail}</div>
                    </div>
                    <div className="sf-display sf-num" style={{ fontSize: 22, color: alert.tone === 'danger' ? 'var(--danger)' : alert.tone === 'warn' ? 'var(--gold-2)' : 'var(--brand)', fontWeight: 650, textAlign: 'right' }}>{alert.value}</div>
                    <span className={`sf-pill ${alert.tone === 'danger' ? 'sf-pill-danger' : alert.tone === 'warn' ? 'sf-pill-warn' : 'sf-pill-success'}`} style={{ justifyContent: 'center' }}>{alert.tone === 'success' ? 'Clear' : 'Review'}</span>
                  </a>
                ))}
              </section>

              <section style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--sf-line)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Runbook checks</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>Phase 5 hardening guardrails</div>
                </div>
                {[
                  ['Provider readiness', readinessStatus, '/admin/ops'],
                  ['Platform balance visible', paystackBalances.length ? 'ready' : 'pending', '/admin/payouts'],
                  ['Large settlement review gate', (settlementSummary.data?.pending_approval_count ?? 0) > 0 ? 'pending review' : 'ready', '/admin/settlements'],
                  ['Lender revenue reconciliation', Number(lenderRevenueSummary.data?.totals.earned_amount ?? 0) > 0 ? 'earned' : 'ready', '/admin/lender-revenue'],
                  ['Money audit trail', 'filter payout events', '/admin/audit?action=payout'],
                ].map(([label, value, href], i, a) => (
                  <a key={label} href={href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none', color: 'inherit', textDecoration: 'none' }}>
                    <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', fontWeight: 650 }}>{label}</div>
                    <Pill value={value} />
                  </a>
                ))}
              </section>
            </div>

            <section style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--sf-line)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Recent payout batches</div>
              </div>
              {(payoutBatches.data?.items ?? []).slice(0, 5).length === 0 ? (
                <Empty text="No payout batches yet" />
              ) : (payoutBatches.data?.items ?? []).slice(0, 5).map((batch, i, a) => (
                <Row key={batch.id} cols="110px 130px 90px 90px 1fr" last={i === a.length - 1}>
                  <Pill value={batch.status} />
                  <strong>{money(batch.total_amount_ghs)}</strong>
                  <span>{batch.agent_count} agents</span>
                  <span>{batch.transfer_count} transfers</span>
                  <span className="sf-mono">{batch.paystack_batch_ref ?? batch.id}</span>
                </Row>
              ))}
            </section>
          </div>
        )}

        {tab === 'dva' && (
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <Header cols="130px 1fr 120px 110px 140px 1fr" labels={['Date', 'Business', 'Amount', 'Status', 'Channel', 'Reference']} />
            {dvaPayments.isLoading && <Empty text="Loading DVA transfers…" />}
            {!dvaPayments.isLoading && dvaPayments.data?.items.length === 0 && <Empty text="No DVA transfers found" />}
            {dvaPayments.data?.items.map((payment, i, a) => (
              <Row key={payment.id} cols="130px 1fr 120px 110px 140px 1fr" last={i === a.length - 1}>
                <span>{new Date(payment.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                <span>{payment.business_name}</span>
                <strong>{money(payment.amount)}</strong>
                <Pill value={payment.status} />
                <span>{payment.channel ?? 'bank transfer'}</span>
                <span className="sf-mono">{payment.external_ref ?? '—'}</span>
              </Row>
            ))}
          </div>
        )}

        {tab === 'transactions' && (
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <Header cols="130px 110px 110px 120px 1fr 120px" labels={['Date', 'Method', 'Status', 'Total', 'Business', 'Balance']} />
            {transactions.isLoading && <Empty text="Loading transactions…" />}
            {!transactions.isLoading && transactions.data?.items.length === 0 && <Empty text="No transactions found" />}
            {transactions.data?.items.map((tx, i, a) => (
              <Row key={tx.id} cols="130px 110px 110px 120px 1fr 120px" last={i === a.length - 1}>
                <span>{new Date(tx.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                <span>{tx.payment_method ?? '—'}</span>
                <Pill value={tx.status} />
                <strong>GH₵ {Number(tx.total).toLocaleString()}</strong>
                <span className="sf-mono">{tx.business_id.slice(0, 8).toUpperCase()}</span>
                <span>GH₵ {Number(tx.balance_due).toLocaleString()}</span>
              </Row>
            ))}
          </div>
        )}

        {tab === 'appeals' && (
          <PanelLoading loading={appeals.isLoading} empty={!appeals.data?.items.length} emptyText="No suspension appeals">
            {appeals.data?.items.map((appeal, i, a) => (
              <Row key={appeal.id} cols="120px 110px 1fr 130px 150px" last={i === a.length - 1}>
                <span className="sf-mono">{appeal.business_id.slice(0, 8).toUpperCase()}</span>
                <Pill value={appeal.status} />
                <span>{appeal.reason}</span>
                <span>{new Date(appeal.created_at).toLocaleDateString('en-GB')}</span>
                {appeal.status === 'pending' ? (
                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setAppealReason(''); setAppealAction({ appeal, action: 'approve' }); }} style={smallActionStyle('approve')}>Approve</button>
                    <button onClick={() => { setAppealReason(''); setRejectTotp(''); setRejectAppeal(appeal); }} style={smallActionStyle('reject')}>Reject</button>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}>{appeal.review_reason ?? 'Reviewed'}</span>
                )}
              </Row>
            ))}
          </PanelLoading>
        )}

        {tab === 'pending' && (
          <PanelLoading loading={pending.isLoading} empty={!pending.data?.items.length} emptyText="No pending admin actions">
            {pending.data?.items.map((action, i, a) => (
              <Row key={action.id} cols="160px 110px 1fr 130px" last={i === a.length - 1}>
                <span className="sf-mono">{action.action_type}</span>
                <Pill value={action.status} />
                <span>{JSON.stringify(action.payload)}</span>
                <span>{new Date(action.expires_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </Row>
            ))}
          </PanelLoading>
        )}

        {tab === 'revenue' && (
          <PanelLoading loading={revenue.isLoading} empty={!revenue.data?.items.length} emptyText="No lender revenue rows">
            {revenue.data?.items.map((row, i, a) => (
              <Row key={row.id} cols="110px 120px 120px 110px 1fr 100px" last={i === a.length - 1}>
                <Pill value={row.status} />
                <strong>GH₵ {Number(row.fee_amount).toLocaleString()}</strong>
                <span>GH₵ {Number(row.principal_amount).toLocaleString()}</span>
                <span>{row.fee_rate_percent}%</span>
                <span className="sf-mono">{row.lender_id}</span>
                <span>{new Date(row.earned_at).toLocaleDateString('en-GB')}</span>
              </Row>
            ))}
          </PanelLoading>
        )}

        {tab === 'readiness' && (
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden', maxWidth: 760 }}>
            {readiness.isLoading && <Empty text="Checking provider readiness…" />}
            {readiness.data && (
              <>
                <div style={{ padding: 18, borderBottom: '1px solid var(--sf-line)', display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ color: 'var(--ink)' }}>Overall status</strong>
                  <Pill value={readiness.data.status} />
                </div>
                {Object.entries(readiness.data.providers ?? {}).map(([provider, info]) => (
                  <div key={provider} style={{ padding: 18, borderBottom: '1px solid var(--sf-line)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>{provider}</strong>
                      <Pill value={info.status ?? (info.missing?.length ? 'blocked' : 'ready')} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      Missing: {info.missing?.length ? info.missing.join(', ') : 'none'}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {(['transactions', 'revenue', 'dva'] as Tab[]).includes(tab) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pagerStyle(page <= 1)}>Previous</button>
            <button onClick={() => setPage((p) => p + 1)} style={pagerStyle(false)}>Next</button>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'center' }}>Page {page}</span>
          </div>
        )}
      </div>
      {rejectAppeal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 420, background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 18 }}>
            <div className="sf-display" style={{ fontSize: 16, fontWeight: 650, color: 'var(--ink)', marginBottom: 8 }}>Reject appeal</div>
            <Textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="Reason for rejection"
              rows={3}
              style={{ fontSize: 13, borderColor: 'var(--sf-line-2)', borderRadius: 10, resize: 'none' }}
            />
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Admin TOTP code</label>
              <Input
                value={rejectTotp}
                onChange={(e) => setRejectTotp(e.target.value)}
                placeholder="6-digit authenticator code"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                style={{ height: 38, borderRadius: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.16em' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => { setRejectAppeal(null); setAppealReason(''); setRejectTotp(''); }} style={modalButtonStyle(false)}>Cancel</button>
              <button
                onClick={() => appealDecision.mutate({ appeal: rejectAppeal, action: 'reject', reason: appealReason.trim(), code: rejectTotp.trim() || undefined })}
                disabled={!appealReason.trim() || appealDecision.isPending}
                style={modalButtonStyle(!appealReason.trim(), true)}
              >
                {appealDecision.isPending ? 'Rejecting...' : 'Reject appeal'}
              </button>
            </div>
          </div>
        </div>
      )}
      <TotpDialog
        open={!!appealAction}
        title="Approve suspension appeal"
        description={appealAction ? `${appealAction.appeal.business_id.slice(0, 8).toUpperCase()} · ${appealAction.appeal.reason}` : undefined}
        confirmLabel="Approve appeal"
        isPending={appealDecision.isPending}
        onOpenChange={(open) => { if (!open) { setAppealAction(null); setAppealReason(''); } }}
        onConfirm={(code) => {
          if (appealAction) appealDecision.mutate({ code, appeal: appealAction.appeal, action: 'approve' });
        }}
      />
    </div>
  );
}

function Header({ cols, labels }: { cols: string; labels: string[] }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '10px 18px',
      borderBottom: '1px solid var(--sf-line)', fontSize: 10.5, color: 'var(--ink-4)',
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {labels.map((label) => <div key={label}>{label}</div>)}
    </div>
  );
}

function Row({ cols, last, children }: { cols: string; last: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '12px 18px',
      borderBottom: last ? 'none' : '1px solid var(--sf-line)', alignItems: 'center',
      fontSize: 12.5, color: 'var(--ink-2)',
    }}>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>{text}</div>;
}

function PanelLoading({ loading, empty, emptyText, children }: { loading: boolean; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
      {loading ? <Empty text="Loading…" /> : empty ? <Empty text={emptyText} /> : children}
    </div>
  );
}

function pagerStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 16px', borderRadius: 9, border: '1px solid var(--sf-line-2)',
    background: 'var(--sf-surface)', color: disabled ? 'var(--ink-4)' : 'var(--ink-2)',
    fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function smallActionStyle(kind: 'approve' | 'reject'): React.CSSProperties {
  return {
    padding: '4px 8px',
    borderRadius: 7,
    border: kind === 'approve' ? 'none' : '1px solid var(--danger)',
    background: kind === 'approve' ? 'var(--brand)' : 'transparent',
    color: kind === 'approve' ? '#fff' : 'var(--danger)',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  };
}

function modalButtonStyle(disabled: boolean, primary = false): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 9,
    border: primary ? 'none' : '1px solid var(--sf-line)',
    background: primary ? (disabled ? 'var(--sf-sunken)' : 'var(--danger)') : 'transparent',
    color: primary ? (disabled ? 'var(--ink-4)' : '#fff') : 'var(--ink-2)',
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
